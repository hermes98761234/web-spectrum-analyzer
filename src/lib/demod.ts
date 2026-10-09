/**
 * Minimal receiver chain for the bonus audio: mix to baseband, boxcar-decimate to an IF rate,
 * demodulate (WBFM or AM), then area-resample to the audio rate. Mono only.
 */
export type DemodMode = 'wbfm' | 'am'

/** Averages the input over each output interval (a sinc low-pass), for any real ratio. */
export class AreaResampler {
  private pos = 0 // fractional position in input samples of the next output start
  private acc = 0
  private readonly step: number

  constructor(inRate: number, outRate: number) {
    this.step = inRate / outRate
  }

  process(x: Float32Array): Float32Array {
    const out: number[] = []
    for (let n = 0; n < x.length; n++) {
      let remain = 1
      while (remain > 1e-12) {
        const need = this.step - this.pos
        if (remain >= need - 1e-12) {
          this.acc += x[n] * need
          out.push(this.acc / this.step)
          this.acc = 0
          this.pos = 0
          remain -= need
        } else {
          this.acc += x[n] * remain
          this.pos += remain
          remain = 0
        }
      }
    }
    return Float32Array.from(out)
  }
}

export interface DemodOptions {
  mode: DemodMode
  inputRate: number
  audioRate: number
  /** Frequency offset of the wanted signal from the centre, Hz. */
  offset: number
  /** De-emphasis time constant in seconds (50e-6 EU/UA, 75e-6 US). WBFM only. */
  deemphasis?: number
}

export class Demodulator {
  private readonly decim: number
  private readonly ifRate: number
  private phase = 0
  private readonly dphi: number
  private sumI = 0
  private sumQ = 0
  private cnt = 0
  private prevI = 1
  private prevQ = 0
  private deemph = 0
  private readonly alpha: number
  private dc = 0
  private readonly resampler: AreaResampler
  private readonly opts: DemodOptions

  constructor(opts: DemodOptions) {
    this.opts = opts
    const target = opts.mode === 'wbfm' ? 200000 : 40000
    this.decim = Math.max(1, Math.round(opts.inputRate / target))
    this.ifRate = opts.inputRate / this.decim
    this.dphi = (-2 * Math.PI * opts.offset) / opts.inputRate
    this.alpha = 1 - Math.exp(-1 / (this.ifRate * (opts.deemphasis ?? 50e-6)))
    this.resampler = new AreaResampler(this.ifRate, opts.audioRate)
  }

  /** Process a block of complex samples (I/Q in [-1, 1]); returns audio samples at `audioRate`. */
  process(i: Float32Array, q: Float32Array, n = i.length): Float32Array {
    const bb = new Float32Array(Math.ceil(n / this.decim) + 1)
    let m = 0
    const mi = new Float32Array(bb.length)
    for (let k = 0; k < n; k++) {
      let c = 1
      let s = 0
      if (this.dphi !== 0) {
        c = Math.cos(this.phase)
        s = Math.sin(this.phase)
        this.phase += this.dphi
        if (this.phase < -Math.PI) this.phase += 2 * Math.PI
        else if (this.phase > Math.PI) this.phase -= 2 * Math.PI
      }
      this.sumI += i[k] * c - q[k] * s
      this.sumQ += i[k] * s + q[k] * c
      if (++this.cnt === this.decim) {
        bb[m] = this.sumI / this.decim
        mi[m] = this.sumQ / this.decim
        m++
        this.sumI = this.sumQ = 0
        this.cnt = 0
      }
    }
    const audioIf = new Float32Array(m)
    if (this.opts.mode === 'wbfm') {
      // Instantaneous frequency from the phase step; ±75 kHz deviation maps to ±1.
      const scale = this.ifRate / (2 * Math.PI * 75000)
      for (let k = 0; k < m; k++) {
        const re = bb[k] * this.prevI + mi[k] * this.prevQ
        const im = mi[k] * this.prevI - bb[k] * this.prevQ
        this.prevI = bb[k]
        this.prevQ = mi[k]
        const d = Math.atan2(im, re) * scale
        this.deemph += this.alpha * (d - this.deemph)
        audioIf[k] = this.deemph
      }
    } else {
      for (let k = 0; k < m; k++) {
        const env = Math.hypot(bb[k], mi[k])
        this.dc += 0.0005 * (env - this.dc)
        audioIf[k] = (env - this.dc) * 2
      }
    }
    return this.resampler.process(audioIf)
  }
}
