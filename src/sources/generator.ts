import { SignalGenerator, type GeneratorConfig } from '../lib/generator'
import type { Source } from './types'

/** Built-in signal generator: needs no permissions and no hardware. */
export class GeneratorSource implements Source {
  readonly iq: boolean
  sampleRate: number
  centerFreq: number
  onBlock: Source['onBlock'] = () => {}
  onError: Source['onError'] = () => {}
  private gen: SignalGenerator
  private timer = 0
  private last = 0
  private owed = 0
  private need = 4096

  constructor(cfg: GeneratorConfig & { centerFreq: number }) {
    this.iq = cfg.iq
    this.sampleRate = cfg.sampleRate
    this.centerFreq = cfg.iq ? cfg.centerFreq : 0
    this.gen = new SignalGenerator(cfg)
  }

  /** Update tones/noise on the fly (sample rate and mode need a restart). */
  update(cfg: GeneratorConfig): void {
    this.gen.cfg = { ...cfg, sampleRate: this.sampleRate, iq: this.iq }
  }

  /** Samples one analysis frame needs: the generator only computes that many per tick and skips the rest. */
  setNeed(n: number): void {
    this.need = n
  }

  async start(): Promise<void> {
    this.last = performance.now()
    this.timer = window.setInterval(() => {
      const now = performance.now()
      this.owed += ((now - this.last) / 1000) * this.sampleRate
      this.last = now
      const owed = Math.floor(this.owed)
      this.owed -= owed
      // Only the latest `need` samples can reach the display, so skip computing the rest (keeps MS/s rates cheap).
      const n = Math.min(owed, this.need)
      if (owed > n) this.gen.skip(owed - n)
      if (n <= 0) return
      const re = new Float32Array(n)
      const im = new Float32Array(n)
      this.gen.fill(re, im)
      this.onBlock(re, this.iq ? im : null)
    }, 30)
  }

  async stop(): Promise<void> {
    window.clearInterval(this.timer)
  }
}
