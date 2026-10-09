import type { ColormapName } from './lib/colormaps'
import { COLORMAPS } from './lib/colormaps'
import { DEFAULT_GENERATOR, type GeneratorConfig } from './lib/generator'
import type { DemodMode } from './lib/demod'
import { WINDOWS, type WindowKind } from './lib/windows'

export type Lang = 'en' | 'uk'
export type Theme = 'auto' | 'light' | 'dark'
export type SourceKind = 'generator' | 'mic' | 'file' | 'sdr'

export const FFT_SIZES = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768]
export const AVERAGES = [1, 2, 4, 8, 16, 32, 64]
export const SDR_RATES = [250000, 1024000, 1536000, 1920000, 2048000, 2400000, 2560000, 2880000, 3200000]
export const GEN_RATES = [8000, 16000, 22050, 32000, 44100, 48000, 96000]
export const SDR_GEN_RATES = [250000, 1024000, 2048000, 2400000]

export interface SdrSettings {
  /** Centre frequency, Hz. */
  freq: number
  rate: number
  /** Tuner gain in dB; null = automatic. */
  gain: number | null
  dcRemove: boolean
  ppm: number
  demod: 'off' | DemodMode
  volume: number
  /** Demodulated channel offset from the centre, Hz. */
  offset: number
}

export interface Settings {
  lang: Lang
  theme: Theme
  source: SourceKind
  fftSize: number
  window: WindowKind
  averages: number
  peakHold: boolean
  logAxis: boolean
  colormap: ColormapName
  floor: number
  ceiling: number
  wfRate: number
  peakCount: number
  gen: GeneratorConfig & { centerFreq: number }
  sdr: SdrSettings
}

/** Generator presets per mode; IQ tones are offsets from the centre frequency. */
export const GEN_REAL: Settings['gen'] = { ...DEFAULT_GENERATOR, centerFreq: 0 }
export const GEN_IQ: Settings['gen'] = {
  sampleRate: 2048000,
  iq: true,
  centerFreq: 100e6,
  tones: [
    { enabled: true, freq: -400e3, level: -20 },
    { enabled: true, freq: 250e3, level: -35 },
  ],
  chirp: { enabled: true, f0: -900e3, f1: 900e3, period: 6, level: -45 },
  noise: { enabled: true, level: -45 },
}

export const DEFAULTS: Settings = {
  lang: 'en',
  theme: 'auto',
  source: 'generator',
  fftSize: 4096,
  window: 'hann',
  averages: 4,
  peakHold: false,
  logAxis: false,
  colormap: 'viridis',
  floor: -110,
  ceiling: 0,
  wfRate: 20,
  peakCount: 5,
  gen: GEN_REAL,
  sdr: { freq: 100.0e6, rate: 2048000, gain: null, dcRemove: true, ppm: 0, demod: 'off', volume: 0.7, offset: 0 },
}

const KEY = 'web-spectrum-analyzer:v1'

const num = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const oneOf = <T,>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)

/** Merge stored JSON over the defaults, discarding anything with the wrong shape. */
export function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const g = (r.gen && typeof r.gen === 'object' ? r.gen : {}) as Record<string, unknown>
  const s = (r.sdr && typeof r.sdr === 'object' ? r.sdr : {}) as Record<string, unknown>
  const iq = g.iq === true
  const baseGen = iq ? GEN_IQ : GEN_REAL
  const tones = Array.isArray(g.tones)
    ? baseGen.tones.map((d, i) => {
        const t = (g.tones as Record<string, unknown>[])[i] ?? {}
        return { enabled: typeof t.enabled === 'boolean' ? t.enabled : d.enabled, freq: num(t.freq, d.freq, -5e6, 5e6), level: num(t.level, d.level, -140, 0) }
      })
    : baseGen.tones
  const c = (g.chirp && typeof g.chirp === 'object' ? g.chirp : {}) as Record<string, unknown>
  const nz = (g.noise && typeof g.noise === 'object' ? g.noise : {}) as Record<string, unknown>
  return {
    lang: oneOf(r.lang, ['en', 'uk'] as const, DEFAULTS.lang),
    theme: oneOf(r.theme, ['auto', 'light', 'dark'] as const, DEFAULTS.theme),
    source: oneOf(r.source, ['generator', 'mic', 'file', 'sdr'] as const, DEFAULTS.source),
    fftSize: oneOf(r.fftSize, FFT_SIZES, DEFAULTS.fftSize),
    window: oneOf(r.window, WINDOWS, DEFAULTS.window),
    averages: oneOf(r.averages, AVERAGES, DEFAULTS.averages),
    peakHold: r.peakHold === true,
    logAxis: r.logAxis === true,
    colormap: oneOf(r.colormap, COLORMAPS, DEFAULTS.colormap),
    floor: num(r.floor, DEFAULTS.floor, -200, -10),
    ceiling: num(r.ceiling, DEFAULTS.ceiling, -100, 20),
    wfRate: num(r.wfRate, DEFAULTS.wfRate, 1, 60),
    peakCount: num(r.peakCount, DEFAULTS.peakCount, 0, 20),
    gen: {
      iq,
      sampleRate: num(g.sampleRate, baseGen.sampleRate, 1000, 4e6),
      centerFreq: num(g.centerFreq, baseGen.centerFreq, 0, 2e9),
      tones,
      chirp: {
        enabled: typeof c.enabled === 'boolean' ? c.enabled : baseGen.chirp.enabled,
        f0: num(c.f0, baseGen.chirp.f0, -5e6, 5e6),
        f1: num(c.f1, baseGen.chirp.f1, -5e6, 5e6),
        period: num(c.period, baseGen.chirp.period, 0.1, 60),
        level: num(c.level, baseGen.chirp.level, -140, 0),
      },
      noise: { enabled: typeof nz.enabled === 'boolean' ? nz.enabled : baseGen.noise.enabled, level: num(nz.level, baseGen.noise.level, -140, 0) },
    },
    sdr: {
      freq: num(s.freq, DEFAULTS.sdr.freq, 24e6, 1766e6),
      rate: oneOf(s.rate, SDR_RATES, DEFAULTS.sdr.rate),
      gain: s.gain === null || s.gain === undefined ? null : num(s.gain, 30, 0, 50),
      dcRemove: s.dcRemove !== false,
      ppm: num(s.ppm, 0, -200, 200),
      demod: oneOf(s.demod, ['off', 'wbfm', 'am'] as const, 'off'),
      volume: num(s.volume, DEFAULTS.sdr.volume, 0, 1),
      offset: num(s.offset, 0, -1.6e6, 1.6e6),
    },
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return sanitize(raw ? JSON.parse(raw) : null)
  } catch {
    return sanitize(null)
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Storage may be unavailable (private mode); settings just won't persist.
  }
}
