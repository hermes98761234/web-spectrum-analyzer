import { getFFT } from './fft'
import { coherentGain, makeWindow, type WindowKind } from './windows'

/** Floor used instead of -Infinity for empty bins. */
export const DB_FLOOR = -200

export interface SpectrumFrame {
  /** Frequency of bin 0, in Hz (for IQ input this is centre − fs/2). */
  freq0: number
  /** Bin spacing in Hz. */
  df: number
  /** Levels in dBFS. */
  db: Float32Array
}

/**
 * Power spectrum of one block, in linear power units relative to full scale.
 *
 * Real input (iq = false): returns N/2 + 1 bins, single-sided; a full-scale sine reads 1.0 (0 dBFS).
 * Complex input (iq = true): returns N bins in fft-shifted order (−fs/2 … +fs/2); a full-scale
 * complex exponential (|x| = 1) reads 1.0 (0 dBFS).
 *
 * `re`/`im` are overwritten (windowed and transformed in place).
 */
export function powerSpectrum(
  re: Float32Array,
  im: Float32Array,
  window: Float32Array,
  iq: boolean,
  out?: Float32Array,
): Float32Array {
  const n = window.length
  const cg = coherentGain(window)
  for (let i = 0; i < n; i++) {
    re[i] *= window[i]
    im[i] = iq ? im[i] * window[i] : 0
  }
  getFFT(n).forward(re, im)
  const scale = (iq ? 1 : 2) / (n * cg)
  const s2 = scale * scale
  if (iq) {
    const o = out && out.length >= n ? out : new Float32Array(n)
    const h = n / 2
    for (let k = 0; k < n; k++) {
      const src = (k + h) % n
      o[k] = (re[src] * re[src] + im[src] * im[src]) * s2
    }
    return o
  }
  const bins = n / 2 + 1
  const o = out && out.length >= bins ? out : new Float32Array(bins)
  for (let k = 0; k < bins; k++) o[k] = (re[k] * re[k] + im[k] * im[k]) * s2
  // DC and Nyquist bins have no mirror image, so they are not doubled.
  o[0] /= 4
  o[bins - 1] /= 4
  return o
}

export function powerToDb(p: number): number {
  return p > 1e-20 ? 10 * Math.log10(p) : DB_FLOOR
}

/** Exponential power averaging and per-bin peak hold. */
export class Accumulator {
  private avg: Float32Array = new Float32Array(0)
  private peak: Float32Array = new Float32Array(0)
  private count = 0

  reset(): void {
    this.avg = new Float32Array(0)
    this.peak = new Float32Array(0)
    this.count = 0
  }

  resetPeak(): void {
    this.peak = new Float32Array(0)
  }

  /**
   * Fold one power spectrum in. `averages` ≥ 1: the first frames use a plain running mean,
   * then the weight settles at 1/averages (exponential average, in the power domain).
   * Returns the averaged level (dB) and peak-hold (dB) arrays.
   */
  push(power: Float32Array, averages: number, dbOut: Float32Array, peakOut: Float32Array): void {
    const n = power.length
    if (this.avg.length !== n) {
      this.avg = new Float32Array(n)
      this.count = 0
    }
    if (this.peak.length !== n) this.peak = new Float32Array(n).fill(DB_FLOOR)
    this.count++
    const a = 1 / Math.min(this.count, Math.max(1, averages))
    for (let k = 0; k < n; k++) {
      this.avg[k] += a * (power[k] - this.avg[k])
      const d = powerToDb(this.avg[k])
      dbOut[k] = d
      if (d > this.peak[k]) this.peak[k] = d
      peakOut[k] = this.peak[k]
    }
  }
}

export interface AnalyzerConfig {
  size: number
  window: WindowKind
  iq: boolean
  sampleRate: number
  /** Centre frequency (Hz) for IQ input; ignored for real input. */
  centerFreq: number
  averages: number
}

export interface AnalyzerOutput {
  frame: SpectrumFrame
  peak: Float32Array
}

/** Turns the latest block of samples into a (possibly averaged) dBFS spectrum plus peak hold. */
export class SpectrumAnalyzer {
  private cfgKey = ''
  private window: Float32Array = new Float32Array(0)
  private re: Float32Array = new Float32Array(0)
  private im: Float32Array = new Float32Array(0)
  private power: Float32Array = new Float32Array(0)
  private readonly acc = new Accumulator()

  resetPeak(): void {
    this.acc.resetPeak()
  }

  reset(): void {
    this.acc.reset()
  }

  analyze(cfg: AnalyzerConfig, inRe: Float32Array, inIm: Float32Array): AnalyzerOutput {
    const key = `${cfg.size}|${cfg.window}|${cfg.iq}|${cfg.sampleRate}|${cfg.centerFreq}`
    if (key !== this.cfgKey) {
      // Any change of geometry invalidates running averages.
      this.cfgKey = key
      this.window = makeWindow(cfg.window, cfg.size)
      this.re = new Float32Array(cfg.size)
      this.im = new Float32Array(cfg.size)
      this.acc.reset()
    }
    this.re.set(inRe.subarray(0, cfg.size))
    this.im.set(inIm.subarray(0, cfg.size))
    this.power = powerSpectrum(this.re, this.im, this.window, cfg.iq, this.power)
    const bins = cfg.iq ? cfg.size : cfg.size / 2 + 1
    const db = new Float32Array(bins)
    const peak = new Float32Array(bins)
    this.acc.push(this.power.subarray(0, bins), cfg.averages, db, peak)
    const df = cfg.sampleRate / cfg.size
    return { frame: { freq0: cfg.iq ? cfg.centerFreq - cfg.sampleRate / 2 : 0, df, db }, peak }
  }
}

export interface Peak {
  freq: number
  db: number
  bin: number
}

/**
 * Local maxima above `threshold` dB, strongest first, at least `minSpacingBins` apart.
 * Frequency and level are refined with parabolic interpolation on the dB values.
 */
export function findPeaks(frame: SpectrumFrame, count: number, threshold: number, minSpacingBins = 3): Peak[] {
  const { db, freq0, df } = frame
  const cand: Peak[] = []
  for (let k = 1; k < db.length - 1; k++) {
    if (db[k] > threshold && db[k] >= db[k - 1] && db[k] > db[k + 1]) {
      const a = db[k - 1]
      const b = db[k]
      const c = db[k + 1]
      const denom = a - 2 * b + c
      const delta = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0
      cand.push({ bin: k, freq: freq0 + (k + delta) * df, db: b - 0.25 * (a - c) * delta })
    }
  }
  cand.sort((x, y) => y.db - x.db)
  const out: Peak[] = []
  for (const p of cand) {
    if (out.every((q) => Math.abs(q.bin - p.bin) >= minSpacingBins)) out.push(p)
    if (out.length >= count) break
  }
  return out
}

/** Suggested display range: a little below the median noise floor up to a little above the strongest bin. */
export function autoLevels(db: ArrayLike<number>): { floor: number; ceiling: number } {
  const s = Array.from(db as ArrayLike<number>).sort((a, b) => a - b)
  if (s.length === 0) return { floor: -110, ceiling: 0 }
  const median = s[s.length >> 1]
  const max = s[s.length - 1]
  const ceiling = Math.min(20, Math.ceil((max + 10) / 5) * 5)
  const floor = Math.max(-200, Math.min(ceiling - 30, Math.floor((median - 10) / 5) * 5))
  return { floor, ceiling }
}
