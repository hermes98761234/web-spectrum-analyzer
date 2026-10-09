export interface Tone {
  enabled: boolean
  /** Hz. May be negative in IQ mode. */
  freq: number
  /** dBFS (amplitude of the tone, 0 = full scale). */
  level: number
}

export interface Chirp {
  enabled: boolean
  f0: number
  f1: number
  /** Sweep period in seconds (sawtooth sweep). */
  period: number
  level: number
}

export interface Noise {
  enabled: boolean
  /** RMS level in dBFS. */
  level: number
}

export interface GeneratorConfig {
  sampleRate: number
  iq: boolean
  tones: Tone[]
  chirp: Chirp
  noise: Noise
}

export const dbToAmp = (db: number): number => Math.pow(10, db / 20)

/** Small deterministic PRNG so noise is reproducible in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Phase-continuous test-signal source. Real mode writes `re`; IQ mode writes complex exponentials. */
export class SignalGenerator {
  private n = 0
  private readonly rand: () => number
  private spare: number | null = null

  cfg: GeneratorConfig

  constructor(cfg: GeneratorConfig, seed = 1) {
    this.cfg = cfg
    this.rand = mulberry32(seed)
  }

  private gauss(): number {
    if (this.spare !== null) {
      const s = this.spare
      this.spare = null
      return s
    }
    let u = 0
    while (u === 0) u = this.rand()
    const v = this.rand()
    const r = Math.sqrt(-2 * Math.log(u))
    this.spare = r * Math.sin(2 * Math.PI * v)
    return r * Math.cos(2 * Math.PI * v)
  }

  /** Advance the phase/time base by `count` samples without computing them (the signal stays coherent). */
  skip(count: number): void {
    this.n += count
  }

  /** Fill `re` (and `im` when cfg.iq) with the next `re.length` samples. */
  fill(re: Float32Array, im: Float32Array): void {
    const { sampleRate: fs, iq, tones, chirp, noise } = this.cfg
    const len = re.length
    const noiseAmp = noise.enabled ? dbToAmp(noise.level) : 0
    for (let i = 0; i < len; i++) {
      const t = (this.n + i) / fs
      let sr = 0
      let si = 0
      for (const tone of tones) {
        if (!tone.enabled) continue
        const a = dbToAmp(tone.level)
        // Phase from the absolute sample index keeps tones coherent across blocks.
        const ph = 2 * Math.PI * ((tone.freq * (this.n + i)) / fs % 1)
        if (iq) {
          sr += a * Math.cos(ph)
          si += a * Math.sin(ph)
        } else sr += a * Math.sin(ph)
      }
      if (chirp.enabled && chirp.period > 0) {
        const tp = t % chirp.period
        const k = (chirp.f1 - chirp.f0) / chirp.period
        // Instantaneous phase of a linear sweep, restarted every period.
        const ph = 2 * Math.PI * (chirp.f0 * tp + 0.5 * k * tp * tp)
        const a = dbToAmp(chirp.level)
        if (iq) {
          sr += a * Math.cos(ph)
          si += a * Math.sin(ph)
        } else sr += a * Math.sin(ph)
      }
      if (noiseAmp > 0) {
        // Real: variance σ² = noiseAmp². IQ: each of I and Q gets σ²/2 so total RMS is noiseAmp.
        if (iq) {
          sr += (noiseAmp / Math.SQRT2) * this.gauss()
          si += (noiseAmp / Math.SQRT2) * this.gauss()
        } else sr += noiseAmp * this.gauss()
      }
      re[i] = sr
      im[i] = iq ? si : 0
    }
    this.n += len
  }
}

export const DEFAULT_GENERATOR: GeneratorConfig = {
  sampleRate: 48000,
  iq: false,
  tones: [
    { enabled: true, freq: 1000, level: -6 },
    { enabled: true, freq: 5000, level: -26 },
  ],
  chirp: { enabled: false, f0: 200, f1: 20000, period: 4, level: -20 },
  noise: { enabled: true, level: -70 },
}
