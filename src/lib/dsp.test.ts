import { describe, expect, it } from 'vitest'
import { iqFromU8, removeDc, rms } from './dsp'
import { AreaResampler, Demodulator } from './demod'
import { SpectrumAnalyzer, findPeaks } from './spectrum'

describe('dsp', () => {
  it('converts unsigned 8-bit IQ', () => {
    const i = new Float32Array(2)
    const q = new Float32Array(2)
    expect(iqFromU8(Uint8Array.of(0, 255, 127, 128), i, q)).toBe(2)
    expect(i[0]).toBeCloseTo(-1, 2)
    expect(q[0]).toBeCloseTo(1, 2)
    expect(Math.abs(i[1])).toBeLessThan(0.01)
  })

  it('removes DC', () => {
    const i = Float32Array.of(1, 2, 3)
    const q = Float32Array.of(5, 5, 5)
    removeDc(i, q)
    expect(Array.from(i)).toEqual([-1, 0, 1])
    expect(Array.from(q)).toEqual([0, 0, 0])
    expect(rms(i)).toBeCloseTo(Math.sqrt(2 / 3), 6)
  })
})

function audioPeak(x: Float32Array, fs: number): number {
  const n = 4096
  const seg = x.slice(x.length - n)
  const { frame } = new SpectrumAnalyzer().analyze({ size: n, window: 'hann', iq: false, sampleRate: fs, centerFreq: 0, averages: 1 }, seg, new Float32Array(n))
  return findPeaks(frame, 1, -80)[0].freq
}

describe('Demodulator', () => {
  it('resamples with the right output count', () => {
    const r = new AreaResampler(250000, 48000)
    const out = r.process(new Float32Array(250000).fill(1))
    expect(Math.abs(out.length - 48000)).toBeLessThanOrEqual(1)
    expect(out[100]).toBeCloseTo(1, 5)
  })

  it('recovers a 1 kHz tone from WBFM, also off-centre', () => {
    const fs = 2.4e6
    const n = 480000
    const i = new Float32Array(n)
    const q = new Float32Array(n)
    const offset = 300e3
    let ph = 0
    for (let t = 0; t < n; t++) {
      const m = Math.sin((2 * Math.PI * 1000 * t) / fs)
      ph += (2 * Math.PI * (offset + 75e3 * m)) / fs
      i[t] = Math.cos(ph)
      q[t] = Math.sin(ph)
    }
    const d = new Demodulator({ mode: 'wbfm', inputRate: fs, audioRate: 48000, offset })
    const audio = d.process(i, q)
    expect(audio.length).toBeGreaterThan(9000)
    expect(audioPeak(audio, 48000)).toBeCloseTo(1000, -1)
    expect(rms(audio.slice(2000))).toBeGreaterThan(0.3)
  })

  it('recovers a 700 Hz tone from AM', () => {
    const fs = 1.024e6
    const n = 200000
    const i = new Float32Array(n)
    const q = new Float32Array(n)
    for (let t = 0; t < n; t++) {
      const env = 0.5 * (1 + 0.8 * Math.sin((2 * Math.PI * 700 * t) / fs))
      i[t] = env
    }
    const audio = new Demodulator({ mode: 'am', inputRate: fs, audioRate: 48000, offset: 0 }).process(i, q)
    expect(audioPeak(audio, 48000)).toBeCloseTo(700, -1)
  })
})
