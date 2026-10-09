import type { SpectrumFrame } from './spectrum'

/** Horizontal view: the frequency interval [fmin, fmax] mapped to x in [0, 1], linear or logarithmic. */
export interface View {
  fmin: number
  fmax: number
  log: boolean
}

/** Lowest frequency shown on a log axis. */
export const LOG_FMIN = 10

export function freqToX(v: View, f: number): number {
  if (v.log) {
    const lo = Math.log(Math.max(v.fmin, 1e-9))
    return (Math.log(Math.max(f, 1e-9)) - lo) / (Math.log(v.fmax) - lo)
  }
  return (f - v.fmin) / (v.fmax - v.fmin)
}

export function xToFreq(v: View, x: number): number {
  if (v.log) {
    const lo = Math.log(Math.max(v.fmin, 1e-9))
    return Math.exp(lo + x * (Math.log(v.fmax) - lo))
  }
  return v.fmin + x * (v.fmax - v.fmin)
}

/**
 * Resample a spectrum to `width` pixel columns. Where a column covers several bins the maximum is
 * taken (so narrow peaks never vanish); where it covers less than one bin the level is interpolated.
 * Columns outside the data are filled with `fill`.
 */
export function toColumns(db: ArrayLike<number>, freq0: number, df: number, v: View, width: number, fill: number, out?: Float32Array): Float32Array {
  const o = out && out.length >= width ? out : new Float32Array(width)
  const n = db.length
  for (let c = 0; c < width; c++) {
    const fa = xToFreq(v, c / width)
    const fb = xToFreq(v, (c + 1) / width)
    const ba = (fa - freq0) / df
    const bb = (fb - freq0) / df
    if (bb < -0.5 || ba > n - 0.5) {
      o[c] = fill
      continue
    }
    if (bb - ba <= 1) {
      const p = (ba + bb) / 2
      const i0 = Math.floor(p)
      const t = p - i0
      const a = i0 >= 0 && i0 < n ? db[i0] : fill
      const b = i0 + 1 >= 0 && i0 + 1 < n ? db[i0 + 1] : a
      o[c] = a + (b - a) * t
    } else {
      const lo = Math.max(0, Math.ceil(ba - 0.5))
      const hi = Math.min(n - 1, Math.floor(bb - 0.5))
      let m = fill
      for (let k = lo; k <= hi; k++) if (db[k] > m || m === fill) m = db[k]
      o[c] = m
    }
  }
  return o
}

export function frameToColumns(f: SpectrumFrame | { freq0: number; df: number; db: ArrayLike<number> }, v: View, width: number, fill: number, out?: Float32Array): Float32Array {
  return toColumns(f.db, f.freq0, f.df, v, width, fill, out)
}

export interface Tick {
  value: number
  label: string
  major: boolean
}

/** 1-2-5 step at or above `raw`. */
export function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}

export function formatFreq(f: number, decimals?: number): string {
  const a = Math.abs(f)
  if (a >= 1e9) return `${(f / 1e9).toFixed(decimals ?? 4)} GHz`
  if (a >= 1e6) return `${(f / 1e6).toFixed(decimals ?? 4)} MHz`
  if (a >= 1e3) return `${(f / 1e3).toFixed(decimals ?? 2)} kHz`
  return `${f.toFixed(decimals ?? 1)} Hz`
}

/** Compact axis label: no unit-repeat digits beyond what the step needs. */
export function tickLabel(f: number, step: number): string {
  const a = Math.abs(f)
  if (a >= 1e9) return trimZeros((f / 1e9).toFixed(decimalsFor(step / 1e9))) + 'G'
  if (a >= 1e6) return trimZeros((f / 1e6).toFixed(decimalsFor(step / 1e6))) + 'M'
  if (a >= 1e3) return trimZeros((f / 1e3).toFixed(decimalsFor(step / 1e3))) + 'k'
  return trimZeros(f.toFixed(decimalsFor(step)))
}

function decimalsFor(step: number): number {
  return Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)))
}
function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** Ticks for a view. Log axes get 1-2-5 per decade; linear axes get a 1-2-5 step near `maxTicks`. */
export function makeTicks(v: View, maxTicks: number): Tick[] {
  const ticks: Tick[] = []
  if (v.log) {
    const d0 = Math.floor(Math.log10(v.fmin))
    const d1 = Math.ceil(Math.log10(v.fmax))
    // 1-2-5 per decade when there is room, otherwise decades only.
    const perDecade = maxTicks / Math.max(1e-9, Math.log10(v.fmax / v.fmin))
    const mults = perDecade >= 4 ? [1, 2, 5] : [1]
    for (let d = d0; d <= d1; d++) {
      for (const m of mults) {
        const f = m * Math.pow(10, d)
        if (f >= v.fmin && f <= v.fmax) ticks.push({ value: f, label: tickLabel(f, f), major: m === 1 })
      }
    }
    return ticks
  }
  const step = niceStep((v.fmax - v.fmin) / Math.max(2, maxTicks))
  const first = Math.ceil(v.fmin / step) * step
  for (let f = first; f <= v.fmax + step * 1e-9; f += step) {
    const fr = Math.abs(f) < step * 1e-9 ? 0 : f
    ticks.push({ value: fr, label: tickLabel(fr, step), major: true })
  }
  return ticks
}

const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

/** Nearest equal-tempered note (A4 = 440 Hz) with the deviation in cents, or null below 16 Hz. */
export function noteName(f: number): { name: string; cents: number } | null {
  if (!(f >= 16)) return null
  const midi = 69 + 12 * Math.log2(f / 440)
  const r = Math.round(midi)
  return { name: `${NOTES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`, cents: Math.round((midi - r) * 100) }
}

/** Zoom the view about `anchor` (0..1 of the view width) by `factor` (<1 zooms in), clamped to [lo, hi]. */
export function zoomView(v: View, anchor: number, factor: number, lo: number, hi: number, minSpan: number): View {
  const f0 = xToFreq(v, anchor)
  let a: number
  let b: number
  if (v.log) {
    a = Math.exp(Math.log(f0) - (Math.log(f0) - Math.log(v.fmin)) * factor)
    b = Math.exp(Math.log(f0) + (Math.log(v.fmax) - Math.log(f0)) * factor)
  } else {
    a = f0 - (f0 - v.fmin) * factor
    b = f0 + (v.fmax - f0) * factor
  }
  if (b - a < minSpan) return v
  if (a < lo) a = lo
  if (b > hi) b = hi
  if (a >= b) return { ...v, fmin: lo, fmax: hi }
  return { ...v, fmin: a, fmax: b }
}

/** Shift the view by `dxFrac` of its width (positive = towards higher frequencies), clamped to [lo, hi]. */
export function panView(v: View, dxFrac: number, lo: number, hi: number): View {
  if (v.log) {
    const a = Math.log(v.fmin)
    const b = Math.log(v.fmax)
    const span = b - a
    let na = a + dxFrac * span
    const llo = Math.log(lo)
    const lhi = Math.log(hi)
    na = Math.max(llo, Math.min(lhi - span, na))
    return { ...v, fmin: Math.exp(na), fmax: Math.exp(na + span) }
  }
  const span = v.fmax - v.fmin
  const na = Math.max(lo, Math.min(hi - span, v.fmin + dxFrac * span))
  return { ...v, fmin: na, fmax: na + span }
}
