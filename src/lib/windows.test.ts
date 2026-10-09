import { describe, expect, it } from 'vitest'
import { coherentGain, enbw, makeWindow, WINDOWS } from './windows'

describe('windows', () => {
  const N = 4096
  it('has the textbook coherent gain', () => {
    expect(coherentGain(makeWindow('rectangular', N))).toBeCloseTo(1, 6)
    expect(coherentGain(makeWindow('hann', N))).toBeCloseTo(0.5, 6)
    expect(coherentGain(makeWindow('hamming', N))).toBeCloseTo(0.54, 6)
    expect(coherentGain(makeWindow('blackman-harris', N))).toBeCloseTo(0.35875, 6)
    expect(coherentGain(makeWindow('flat-top', N))).toBeCloseTo(0.21557895, 6)
  })

  it('has the textbook equivalent noise bandwidth', () => {
    expect(enbw(makeWindow('rectangular', N))).toBeCloseTo(1, 6)
    expect(enbw(makeWindow('hann', N))).toBeCloseTo(1.5, 4)
    expect(enbw(makeWindow('hamming', N))).toBeCloseTo(1.3628, 3)
    expect(enbw(makeWindow('blackman-harris', N))).toBeCloseTo(2.0044, 3)
    expect(enbw(makeWindow('flat-top', N))).toBeCloseTo(3.77, 1)
  })

  it('has the expected shape', () => {
    const h = makeWindow('hann', 8)
    expect(h[0]).toBeCloseTo(0, 6)
    expect(h[4]).toBeCloseTo(1, 6)
    expect(h[2]).toBeCloseTo(0.5, 6)
    const hm = makeWindow('hamming', 8)
    expect(hm[0]).toBeCloseTo(0.08, 6)
    for (const k of WINDOWS) expect(makeWindow(k, 16)).toHaveLength(16)
  })
})
