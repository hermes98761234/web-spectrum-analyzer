import { describe, expect, it } from 'vitest'
import { Accumulator, findPeaks, powerSpectrum, powerToDb, SpectrumAnalyzer } from './spectrum'
import { makeWindow, WINDOWS } from './windows'
import { ComplexRing } from './ring'

const N = 4096

function sine(freqBin: number, amp: number, n = N, phase = 0.3) {
  const re = new Float32Array(n)
  for (let t = 0; t < n; t++) re[t] = amp * Math.sin((2 * Math.PI * freqBin * t) / n + phase)
  return { re, im: new Float32Array(n) }
}

describe('powerSpectrum', () => {
  it('reads a full-scale on-bin sine as 0 dBFS in the right bin, for every window', () => {
    for (const w of WINDOWS) {
      const { re, im } = sine(300, 1)
      const p = powerSpectrum(re, im, makeWindow(w, N), false)
      let best = 0
      for (let k = 0; k < p.length; k++) if (p[k] > p[best]) best = k
      expect(best).toBe(300)
      expect(powerToDb(p[best])).toBeCloseTo(0, 1)
    }
  })

  it('scales with amplitude', () => {
    const { re, im } = sine(100, 0.1)
    const p = powerSpectrum(re, im, makeWindow('hann', N), false)
    expect(powerToDb(p[100])).toBeCloseTo(-20, 1)
  })

  it('flat-top keeps the level accurate for an off-bin tone, rectangular does not', () => {
    const a = sine(300.5, 1)
    const b = sine(300.5, 1)
    const flat = powerSpectrum(a.re, a.im, makeWindow('flat-top', N), false)
    const rect = powerSpectrum(b.re, b.im, makeWindow('rectangular', N), false)
    const peak = (p: Float32Array) => powerToDb(Math.max(...p))
    expect(Math.abs(peak(flat))).toBeLessThan(0.1)
    expect(peak(rect)).toBeLessThan(-2.5)
  })

  it('conserves energy (Parseval) for white-ish noise with a rectangular window', () => {
    const re = new Float32Array(N)
    let s = 7
    let et = 0
    for (let i = 0; i < N; i++) {
      s = (s * 1664525 + 1013904223) >>> 0
      re[i] = s / 2 ** 32 - 0.5
      et += re[i] * re[i]
    }
    const p = powerSpectrum(re, new Float32Array(N), makeWindow('rectangular', N), false)
    // Single-sided power sums to 2·mean(x²)·... : Σp = 2·Σ|X|²/N² -> compare against mean square ×2.
    let sum = 0
    for (let k = 0; k < p.length; k++) sum += p[k]
    // Σp over the half spectrum equals 2·(1/N)Σx² (a unit sine has mean square 1/2 and Σp = 1).
    expect(sum / 2).toBeCloseTo(et / N, 3)
  })

  it('handles complex input, fft-shifted, with negative frequencies', () => {
    const re = new Float32Array(N)
    const im = new Float32Array(N)
    const bin = -200
    for (let t = 0; t < N; t++) {
      re[t] = Math.cos((2 * Math.PI * bin * t) / N)
      im[t] = Math.sin((2 * Math.PI * bin * t) / N)
    }
    const p = powerSpectrum(re, im, makeWindow('hann', N), true)
    expect(p).toHaveLength(N)
    let best = 0
    for (let k = 0; k < N; k++) if (p[k] > p[best]) best = k
    expect(best).toBe(N / 2 + bin)
    expect(powerToDb(p[best])).toBeCloseTo(0, 1)
  })
})

describe('SpectrumAnalyzer', () => {
  it('finds a tone at the right frequency (Hz) for real input', () => {
    const fs = 48000
    const f = 1000
    const n = 8192
    const re = new Float32Array(n)
    for (let t = 0; t < n; t++) re[t] = 0.5 * Math.sin((2 * Math.PI * f * t) / fs)
    const an = new SpectrumAnalyzer()
    const { frame } = an.analyze({ size: n, window: 'hann', iq: false, sampleRate: fs, centerFreq: 0, averages: 1 }, re, new Float32Array(n))
    const pk = findPeaks(frame, 3, -60)
    expect(pk[0].freq).toBeCloseTo(f, 0)
    expect(Math.abs(pk[0].db + 6.02)).toBeLessThan(0.25) // off-bin tone: parabolic interpolation residual
  })

  it('offsets IQ spectra by the centre frequency', () => {
    const fs = 2.048e6
    const n = 2048
    const off = 100e3
    const re = new Float32Array(n)
    const im = new Float32Array(n)
    for (let t = 0; t < n; t++) {
      re[t] = Math.cos((2 * Math.PI * off * t) / fs)
      im[t] = Math.sin((2 * Math.PI * off * t) / fs)
    }
    const an = new SpectrumAnalyzer()
    const { frame } = an.analyze({ size: n, window: 'blackman-harris', iq: true, sampleRate: fs, centerFreq: 100e6, averages: 1 }, re, im)
    const pk = findPeaks(frame, 1, -40)
    expect(pk[0].freq).toBeCloseTo(100.1e6, -3)
  })

  it('averages in the power domain', () => {
    const acc = new Accumulator()
    const db = new Float32Array(1)
    const pk = new Float32Array(1)
    acc.push(Float32Array.of(1), 4, db, pk)
    acc.push(Float32Array.of(0.01), 4, db, pk)
    expect(db[0]).toBeCloseTo(10 * Math.log10((1 + 0.01) / 2), 4)
    expect(pk[0]).toBeCloseTo(0, 4) // peak hold keeps the first frame
    acc.resetPeak()
    acc.push(Float32Array.of(0.01), 4, db, pk)
    expect(pk[0]).toBeLessThan(0)
  })
})

describe('findPeaks', () => {
  it('interpolates between bins and respects spacing', () => {
    const db = new Float32Array(64).fill(-100)
    db[10] = -10
    db[11] = -10
    db[12] = -30
    db[11] = -9
    db[13] = -50
    db[40] = -20
    const pk = findPeaks({ freq0: 0, df: 10, db }, 5, -60, 3)
    expect(pk).toHaveLength(2)
    expect(pk[0].bin).toBe(11)
    expect(pk[0].freq).toBeGreaterThan(105)
    expect(pk[0].freq).toBeLessThan(120)
    expect(pk[1].bin).toBe(40)
  })
})

describe('ComplexRing', () => {
  it('returns the most recent samples in order', () => {
    const r = new ComplexRing(8)
    r.pushReal([1, 2, 3, 4, 5, 6])
    r.pushReal([7, 8, 9, 10])
    const a = new Float32Array(5)
    const b = new Float32Array(5)
    expect(r.latest(5, a, b)).toBe(true)
    expect(Array.from(a)).toEqual([6, 7, 8, 9, 10])
    expect(r.latest(9, new Float32Array(9), new Float32Array(9))).toBe(false)
  })
})
