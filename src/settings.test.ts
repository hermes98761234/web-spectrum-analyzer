import { describe, expect, it } from 'vitest'
import { DEFAULTS, GEN_IQ, sanitize } from './settings'

describe('settings', () => {
  it('falls back to defaults for junk input', () => {
    expect(sanitize(null)).toEqual(DEFAULTS)
    expect(sanitize('x')).toEqual(DEFAULTS)
    expect(sanitize({ fftSize: 123, window: 'nope', colormap: 5, sdr: { freq: 'a' } })).toEqual(DEFAULTS)
  })
  it('keeps valid values and clamps numbers', () => {
    const s = sanitize({ fftSize: 32768, window: 'flat-top', floor: -500, sdr: { freq: 433.92e6, gain: 20, demod: 'am' } })
    expect(s.fftSize).toBe(32768)
    expect(s.window).toBe('flat-top')
    expect(s.floor).toBe(-200)
    expect(s.sdr.freq).toBe(433.92e6)
    expect(s.sdr.gain).toBe(20)
    expect(s.sdr.demod).toBe('am')
  })
  it('uses IQ generator defaults when IQ mode is stored', () => {
    expect(sanitize({ gen: { iq: true } }).gen.sampleRate).toBe(GEN_IQ.sampleRate)
  })
})
