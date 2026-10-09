import { describe, expect, it } from 'vitest'
import { formatFreq, freqToX, makeTicks, niceStep, noteName, tickLabel, toColumns, xToFreq, zoomView, type View } from './axis'
import { colorize, makeLut, COLORMAPS } from './colormaps'

const lin: View = { fmin: 0, fmax: 24000, log: false }
const log: View = { fmin: 20, fmax: 20000, log: true }

describe('axis', () => {
  it('round-trips frequency and x for linear and log views', () => {
    for (const v of [lin, log]) {
      for (const x of [0, 0.25, 0.5, 1]) expect(freqToX(v, xToFreq(v, x))).toBeCloseTo(x, 9)
    }
    expect(xToFreq(log, 0.5)).toBeCloseTo(Math.sqrt(20 * 20000), 6)
  })

  it('keeps narrow peaks when many bins share a column (max pooling)', () => {
    const db = new Float32Array(1000).fill(-90)
    db[503] = -10
    const cols = toColumns(db, 0, 1, { fmin: 0, fmax: 1000, log: false }, 50, -120)
    expect(Math.max(...cols)).toBe(-10)
    expect(cols[25]).toBe(-10)
  })

  it('interpolates when zoomed in and fills outside the data', () => {
    const db = Float32Array.of(0, -10, -20)
    const cols = toColumns(db, 100, 10, { fmin: 100, fmax: 120, log: false }, 4, -120)
    expect(cols[0]).toBeGreaterThan(cols[3])
    const out = toColumns(db, 100, 10, { fmin: 200, fmax: 300, log: false }, 4, -120)
    expect(Array.from(out)).toEqual([-120, -120, -120, -120])
  })

  it('makes 1-2-5 ticks', () => {
    expect(niceStep(0.7)).toBe(1)
    expect(niceStep(130)).toBe(200)
    expect(niceStep(3000)).toBe(5000)
    const t = makeTicks(lin, 6)
    expect(t[0].value).toBe(0)
    expect(t.map((x) => x.value)).toContain(10000)
    const tl = makeTicks(log, 12).map((x) => x.value)
    expect(tl).toContain(100)
    expect(tl).toContain(1000)
    expect(tl).toContain(20)
  })

  it('formats frequencies', () => {
    expect(formatFreq(1000)).toBe('1.00 kHz')
    expect(formatFreq(98.5e6)).toBe('98.5000 MHz')
    expect(formatFreq(440)).toBe('440.0 Hz')
    expect(tickLabel(1500, 500)).toBe('1.5k')
    expect(tickLabel(98.2e6, 200e3)).toBe('98.2M')
    expect(tickLabel(0, 1000)).toBe('0')
  })

  it('names notes', () => {
    expect(noteName(440)).toEqual({ name: 'A4', cents: 0 })
    expect(noteName(261.63)?.name).toBe('C4')
    expect(noteName(5)).toBeNull()
  })

  it('zooms about the anchor and stays inside limits', () => {
    const z = zoomView(lin, 0.5, 0.5, 0, 24000, 10)
    expect(z.fmin).toBeCloseTo(6000)
    expect(z.fmax).toBeCloseTo(18000)
    const out = zoomView(z, 0.5, 10, 0, 24000, 10)
    expect(out.fmin).toBe(0)
    expect(out.fmax).toBe(24000)
  })
})

describe('colormaps', () => {
  it('builds a 256-entry LUT for each map and maps the range ends', () => {
    for (const n of COLORMAPS) {
      const lut = makeLut(n)
      expect(lut).toHaveLength(1024)
      const px = new Uint8ClampedArray(8)
      colorize([-200, 50], -100, 0, lut, px)
      expect(Array.from(px.slice(0, 3))).toEqual(Array.from(lut.slice(0, 3)))
      expect(Array.from(px.slice(4, 7))).toEqual(Array.from(lut.slice(1020, 1023)))
    }
    expect(Array.from(makeLut('gray').slice(0, 3))).toEqual([0, 0, 0])
  })
})

import { panView } from './axis'
import { autoLevels } from './spectrum'

describe('panView / autoLevels', () => {
  it('pans linear and log views within limits, keeping the span', () => {
    const v = panView({ fmin: 1000, fmax: 2000, log: false }, 0.5, 0, 24000)
    expect(v.fmin).toBe(1500)
    expect(v.fmax).toBe(2500)
    const edge = panView({ fmin: 1000, fmax: 2000, log: false }, -5, 0, 24000)
    expect(edge).toMatchObject({ fmin: 0, fmax: 1000 })
    const l = panView({ fmin: 100, fmax: 1000, log: true }, 1, 20, 20000)
    expect(l.fmax / l.fmin).toBeCloseTo(10, 6)
    expect(l.fmin).toBeCloseTo(1000, 3)
  })

  it('suggests levels around the data', () => {
    const db = new Float32Array(100).fill(-80)
    db[10] = -20
    const { floor, ceiling } = autoLevels(db)
    expect(ceiling).toBeGreaterThanOrEqual(-10)
    expect(floor).toBeLessThanOrEqual(-90)
    expect(ceiling - floor).toBeGreaterThanOrEqual(30)
  })
})
