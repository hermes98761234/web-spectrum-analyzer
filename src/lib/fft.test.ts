import { describe, expect, it } from 'vitest'
import { dft, FFT, getFFT, isPowerOfTwo } from './fft'

function rand(n: number, seed = 3): Float64Array {
  const a = new Float64Array(n)
  let s = seed
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    a[i] = s / 2 ** 32 - 0.5
  }
  return a
}

describe('FFT', () => {
  it('matches the direct DFT', () => {
    for (const n of [2, 4, 8, 64, 256]) {
      const re = rand(n, 1)
      const im = rand(n, 2)
      const ref = dft(re, im)
      const r = Float64Array.from(re)
      const i = Float64Array.from(im)
      new FFT(n).forward(r, i)
      for (let k = 0; k < n; k++) {
        expect(r[k]).toBeCloseTo(ref.re[k], 9)
        expect(i[k]).toBeCloseTo(ref.im[k], 9)
      }
    }
  })

  it('obeys Parseval: Σ|x|² = (1/N) Σ|X|²', () => {
    for (const n of [256, 4096, 32768]) {
      const re = rand(n, 5)
      const im = rand(n, 6)
      let et = 0
      for (let k = 0; k < n; k++) et += re[k] * re[k] + im[k] * im[k]
      getFFT(n).forward(re, im)
      let ef = 0
      for (let k = 0; k < n; k++) ef += re[k] * re[k] + im[k] * im[k]
      expect(ef / n / et).toBeCloseTo(1, 10)
    }
  })

  it('puts an on-bin complex exponential into exactly one bin', () => {
    const n = 1024
    const bin = 37
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    for (let t = 0; t < n; t++) {
      re[t] = Math.cos((2 * Math.PI * bin * t) / n)
      im[t] = Math.sin((2 * Math.PI * bin * t) / n)
    }
    new FFT(n).forward(re, im)
    expect(re[bin]).toBeCloseTo(n, 6)
    for (let k = 0; k < n; k++) if (k !== bin) expect(Math.hypot(re[k], im[k])).toBeLessThan(1e-6)
  })

  it('rejects sizes that are not powers of two', () => {
    expect(() => new FFT(100)).toThrow()
    expect(isPowerOfTwo(32768)).toBe(true)
    expect(isPowerOfTwo(0)).toBe(false)
  })
})
