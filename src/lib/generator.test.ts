import { describe, expect, it } from 'vitest'
import { DEFAULT_GENERATOR, SignalGenerator, type GeneratorConfig } from './generator'
import { SpectrumAnalyzer, findPeaks } from './spectrum'
import { rms } from './dsp'

const base: GeneratorConfig = { ...DEFAULT_GENERATOR, tones: [], noise: { enabled: false, level: -60 } }

describe('SignalGenerator', () => {
  it('generates a tone in the expected bin and level, across block boundaries', () => {
    const cfg: GeneratorConfig = { ...base, sampleRate: 48000, tones: [{ enabled: true, freq: 3000, level: -12 }] }
    const g = new SignalGenerator(cfg)
    const n = 4096
    const re = new Float32Array(n)
    const im = new Float32Array(n)
    const a = new Float32Array(n / 2)
    const b = new Float32Array(n / 2)
    g.fill(a, new Float32Array(n / 2))
    g.fill(b, new Float32Array(n / 2))
    re.set(a)
    re.set(b, n / 2)
    const { frame } = new SpectrumAnalyzer().analyze({ size: n, window: 'blackman-harris', iq: false, sampleRate: 48000, centerFreq: 0, averages: 1 }, re, im)
    const pk = findPeaks(frame, 1, -60)[0]
    expect(pk.freq).toBeCloseTo(3000, -1)
    expect(Math.abs(pk.db + 12)).toBeLessThan(0.3)
  })

  it('produces noise with the requested RMS', () => {
    const g = new SignalGenerator({ ...base, noise: { enabled: true, level: -20 } })
    const re = new Float32Array(100000)
    g.fill(re, new Float32Array(re.length))
    expect(20 * Math.log10(rms(re))).toBeCloseTo(-20, 0)
    const g2 = new SignalGenerator({ ...base, iq: true, noise: { enabled: true, level: -20 } })
    const i = new Float32Array(100000)
    const q = new Float32Array(100000)
    g2.fill(i, q)
    expect(20 * Math.log10(Math.hypot(rms(i), rms(q)))).toBeCloseTo(-20, 0)
  })

  it('sweeps a chirp from f0 to f1', () => {
    const fs = 48000
    const cfg: GeneratorConfig = { ...base, sampleRate: fs, chirp: { enabled: true, f0: 1000, f1: 9000, period: 1, level: -6 } }
    const g = new SignalGenerator(cfg)
    const n = fs
    const re = new Float32Array(n)
    g.fill(re, new Float32Array(n))
    // Zero crossings per window estimate instantaneous frequency.
    const freqAt = (start: number) => {
      let z = 0
      for (let k = start + 1; k < start + 2400; k++) if (re[k - 1] < 0 !== re[k] < 0) z++
      return z / 2 / (2400 / fs)
    }
    expect(freqAt(0)).toBeGreaterThan(900)
    expect(freqAt(0)).toBeLessThan(1900)
    expect(freqAt(n - 2400)).toBeGreaterThan(8000)
  })

  it('places an IQ tone at a negative frequency', () => {
    const fs = 1e6
    const n = 2048
    const g = new SignalGenerator({ ...base, sampleRate: fs, iq: true, tones: [{ enabled: true, freq: -250e3, level: 0 }] })
    const re = new Float32Array(n)
    const im = new Float32Array(n)
    g.fill(re, im)
    const { frame } = new SpectrumAnalyzer().analyze({ size: n, window: 'hann', iq: true, sampleRate: fs, centerFreq: 0, averages: 1 }, re, im)
    expect(findPeaks(frame, 1, -40)[0].freq).toBeCloseTo(-250e3, -3)
  })
})
