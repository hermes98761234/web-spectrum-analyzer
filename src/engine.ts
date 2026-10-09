import { removeDc } from './lib/dsp'
import { Demodulator, type DemodMode } from './lib/demod'
import { ComplexRing } from './lib/ring'
import { findPeaks, SpectrumAnalyzer, type Peak, type SpectrumFrame } from './lib/spectrum'
import type { WindowKind } from './lib/windows'
import { AudioPlayer } from './sources/player'
import type { Source } from './sources/types'

export interface FrameEvent {
  frame: SpectrumFrame
  peak: Float32Array
  peaks: Peak[]
  iq: boolean
  sampleRate: number
  centerFreq: number
  size: number
}

export interface AnalysisConfig {
  size: number
  window: WindowKind
  averages: number
  peakCount: number
  dcRemove: boolean
}

export interface DemodConfig {
  mode: 'off' | DemodMode
  offset: number
  volume: number
}

export type Status = 'idle' | 'starting' | 'running' | 'error'

const MAX_FPS = 30

/** Owns the running source, the sample ring and the analysis loop; views subscribe to its frames. */
export class Engine {
  private readonly ring = new ComplexRing(65536)
  private readonly analyzer = new SpectrumAnalyzer()
  private readonly frameListeners = new Set<(e: FrameEvent) => void>()
  private readonly statusListeners = new Set<() => void>()
  private source: Source | null = null
  private raf = 0
  private lastRun = 0
  private bufRe = new Float32Array(32768)
  private bufIm = new Float32Array(32768)
  private cfg: AnalysisConfig = { size: 4096, window: 'hann', averages: 4, peakCount: 5, dcRemove: true }
  private demodCfg: DemodConfig = { mode: 'off', offset: 0, volume: 0.7 }
  private demod: Demodulator | null = null
  private demodKey = ''
  private readonly player = new AudioPlayer()
  paused = false

  setPaused(p: boolean): void {
    this.paused = p
  }
  status: Status = 'idle'
  error = ''
  last: FrameEvent | null = null

  subscribe(fn: (e: FrameEvent) => void): () => void {
    this.frameListeners.add(fn)
    return () => this.frameListeners.delete(fn)
  }

  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  private setStatus(s: Status, error = ''): void {
    this.status = s
    this.error = error
    this.statusListeners.forEach((f) => f())
  }

  configure(cfg: Partial<AnalysisConfig>): void {
    this.cfg = { ...this.cfg, ...cfg }
  }

  resetPeak(): void {
    this.analyzer.resetPeak()
  }

  /** Enable audio output; call from a click handler. */
  async enableAudio(): Promise<void> {
    await this.player.start()
    this.player.setVolume(this.demodCfg.volume)
  }

  async disableAudio(): Promise<void> {
    await this.player.stop()
  }

  get audioActive(): boolean {
    return this.player.active
  }

  setDemod(cfg: Partial<DemodConfig>): void {
    this.demodCfg = { ...this.demodCfg, ...cfg }
    this.player.setVolume(this.demodCfg.volume)
  }

  async start(source: Source): Promise<void> {
    await this.stop()
    this.setStatus('starting')
    this.ring.clear()
    this.analyzer.reset()
    this.demod = null
    this.source = source
    source.onBlock = (re, im) => this.handleBlock(re, im)
    source.onError = (m) => {
      void this.fail(m)
    }
    try {
      await source.start()
    } catch (e) {
      this.source = null
      await source.stop().catch(() => undefined)
      this.setStatus('error', e instanceof Error ? e.message : String(e))
      return
    }
    this.setStatus('running')
    this.lastRun = 0
    this.raf = requestAnimationFrame(this.tick)
  }

  private async fail(message: string): Promise<void> {
    const src = this.source
    this.source = null
    cancelAnimationFrame(this.raf)
    await src?.stop().catch(() => undefined)
    this.setStatus('error', message)
  }

  async stop(): Promise<void> {
    cancelAnimationFrame(this.raf)
    const src = this.source
    this.source = null
    if (src) await src.stop().catch(() => undefined)
    if (this.status !== 'idle') this.setStatus('idle')
  }

  /** Drop buffered samples, e.g. after retuning. */
  flush(): void {
    this.ring.clear()
    this.analyzer.reset()
  }

  private handleBlock(re: Float32Array, im: Float32Array | null): void {
    const src = this.source
    if (!src) return
    if (im) {
      if (this.cfg.dcRemove) removeDc(re, im)
      this.ring.pushComplex(re, im)
      this.runDemod(re, im, src.sampleRate)
    } else this.ring.pushReal(re)
  }

  private runDemod(re: Float32Array, im: Float32Array, fs: number): void {
    const d = this.demodCfg
    if (d.mode === 'off' || !this.player.active) return
    const key = `${d.mode}|${d.offset}|${fs}`
    if (key !== this.demodKey || !this.demod) {
      this.demodKey = key
      this.demod = new Demodulator({ mode: d.mode, inputRate: fs, audioRate: AudioPlayer.RATE, offset: d.offset })
    }
    this.player.push(this.demod.process(re, im))
  }

  private tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick)
    if (this.paused || now - this.lastRun < 1000 / MAX_FPS - 2) return
    const src = this.source
    if (!src) return
    const n = this.cfg.size
    if (this.bufRe.length < n) {
      this.bufRe = new Float32Array(n)
      this.bufIm = new Float32Array(n)
    }
    if (!this.ring.latest(n, this.bufRe, this.bufIm)) return
    this.lastRun = now
    const { frame, peak } = this.analyzer.analyze(
      {
        size: n,
        window: this.cfg.window,
        iq: src.iq,
        sampleRate: src.sampleRate,
        centerFreq: src.centerFreq,
        averages: this.cfg.averages,
      },
      this.bufRe,
      this.bufIm,
    )
    const peaks = this.cfg.peakCount > 0 ? findPeaks(frame, this.cfg.peakCount, noiseGate(frame.db), Math.max(3, Math.round(n / 512))) : []
    const ev: FrameEvent = { frame, peak, peaks, iq: src.iq, sampleRate: src.sampleRate, centerFreq: src.centerFreq, size: n }
    this.last = ev
    this.frameListeners.forEach((f) => f(ev))
  }
}

/** Peaks must stand ~15 dB above the median level to count. */
function noiseGate(db: Float32Array): number {
  const step = Math.max(1, Math.floor(db.length / 256))
  const s: number[] = []
  for (let i = 0; i < db.length; i += step) s.push(db[i])
  s.sort((a, b) => a - b)
  return s[s.length >> 1] + 15
}
