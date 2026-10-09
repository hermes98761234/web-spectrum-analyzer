import { iqFromU8 } from '../lib/dsp'
import { RtlSdr } from '../lib/rtlsdr/rtlsdr'
import type { Source } from './types'

const BLOCK_SAMPLES = 32768

export interface SdrParams {
  freq: number
  rate: number
  gain: number | null
  ppm: number
}

/** RTL-SDR dongle over WebUSB. The device must already be chosen (needs a user gesture). */
export class SdrSource implements Source {
  readonly iq = true
  sampleRate: number
  centerFreq: number
  onBlock: Source['onBlock'] = () => {}
  onError: Source['onError'] = () => {}
  /** Called after a retune so stale samples can be discarded. */
  onRetune: () => void = () => {}
  tuner = ''
  private readonly sdr: RtlSdr
  private params: SdrParams
  private pending: Partial<SdrParams> | null = null
  private running = false
  private loop: Promise<void> | null = null
  dcRemove = true

  constructor(sdr: RtlSdr, params: SdrParams) {
    this.sdr = sdr
    this.params = { ...params }
    this.sampleRate = params.rate
    this.centerFreq = params.freq
  }

  /** Queue new tuning; applied between reads. */
  configure(p: Partial<SdrParams>): void {
    this.pending = { ...this.pending, ...p }
  }

  async start(): Promise<void> {
    const p = this.params
    await this.sdr.open({ ppm: p.ppm, gain: p.gain })
    this.tuner = this.sdr.tuner
    try {
      this.sampleRate = await this.sdr.setSampleRate(p.rate)
      this.centerFreq = await this.sdr.setCenterFrequency(p.freq)
      await this.sdr.resetBuffer()
    } catch (e) {
      await this.sdr.close().catch(() => undefined)
      throw e
    }
    this.running = true
    this.loop = this.run()
  }

  private async applyPending(): Promise<void> {
    const p = this.pending
    if (!p) return
    this.pending = null
    if (p.rate !== undefined && p.rate !== this.params.rate) this.sampleRate = await this.sdr.setSampleRate(p.rate)
    if (p.freq !== undefined && (p.freq !== this.params.freq || p.rate !== undefined)) this.centerFreq = await this.sdr.setCenterFrequency(p.freq)
    if (p.gain !== undefined && p.gain !== this.params.gain) await this.sdr.setGain(p.gain)
    this.params = { ...this.params, ...p }
    if (p.rate !== undefined || p.freq !== undefined) this.onRetune()
  }

  private async run(): Promise<void> {
    const i = new Float32Array(BLOCK_SAMPLES)
    const q = new Float32Array(BLOCK_SAMPLES)
    try {
      // Keep one transfer in flight while the previous block is processed, so the dongle's FIFO never starves.
      let next: Promise<Uint8Array> = this.sdr.readSamples(BLOCK_SAMPLES)
      while (this.running) {
        const cur = next
        next = this.sdr.readSamples(BLOCK_SAMPLES)
        next.catch(() => undefined)
        await this.applyPending()
        const bytes = await cur
        if (!this.running) break
        const n = iqFromU8(bytes, i, q)
        if (n > 0) this.onBlock(i.subarray(0, n), q.subarray(0, n))
      }
    } catch (e) {
      if (this.running) {
        this.running = false
        this.onError(e instanceof Error ? e.message : String(e))
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false
    await this.loop?.catch(() => undefined)
    await this.sdr.close().catch(() => undefined)
  }
}
