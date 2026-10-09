import { describe, expect, it } from 'vitest'
import { gainStep, muxIndex, reverseBits } from './r820t'
import { IF_FREQ, sampleRateRatio } from './rtl2832u'
import { RtlSdr } from './rtlsdr'
import type { UsbDeviceLike, UsbSetup } from './rtlcom'

/** A fake dongle: answers the tuner chip-id probe and reports PLL lock, records every control write. */
class FakeDongle implements UsbDeviceLike {
  vendorId = 0x0bda
  productId = 0x2838
  productName = 'Fake RTL2838'
  writes: { value: number; index: number; data: number[] }[] = []
  claimed = false
  opened = false
  private lastI2c = { addr: 0, reg: 0 }
  private readonly tunerAddr: number
  constructor(tunerAddr: number) {
    this.tunerAddr = tunerAddr
  }

  async open() {
    this.opened = true
  }
  async close() {
    this.opened = false
  }
  async selectConfiguration() {}
  async claimInterface() {
    this.claimed = true
  }
  async releaseInterface() {
    this.claimed = false
  }
  async controlTransferOut(s: UsbSetup, data?: BufferSource) {
    const bytes = data ? Array.from(new Uint8Array(data as ArrayBuffer)) : []
    this.writes.push({ value: s.value, index: s.index, data: bytes })
    if (s.index === (0x600 | 0x10)) this.lastI2c = { addr: s.value, reg: bytes[0] }
    return { status: 'ok' }
  }
  async controlTransferIn(s: UsbSetup, length: number) {
    const out = new Uint8Array(length)
    if (s.index === 0x600) {
      // Raw 0x02 is 0x40 after bit reversal: PLL-lock bit set, no filter cap, mid VCO tune.
      out.fill(0x02)
      if (this.lastI2c.reg === 0) out[0] = s.value === this.tunerAddr ? 0x69 : 0x00
    } else out.fill(0x02)
    return { status: 'ok', data: new DataView(out.buffer) }
  }
  async transferIn(_ep: number, length: number) {
    const b = new Uint8Array(length)
    return { status: 'ok', data: new DataView(b.buffer) }
  }
}

describe('R820T helpers', () => {
  it('reverses bits', () => {
    expect(reverseBits(0x96)).toBe(0x69)
    expect(reverseBits(0x02)).toBe(0x40)
    expect(reverseBits(0xff)).toBe(0xff)
  })

  it('maps gain to a step in 0..30', () => {
    expect(gainStep(0)).toBe(1)
    expect(gainStep(-5)).toBe(0)
    expect(gainStep(100)).toBe(30)
    let prev = -1
    for (let g = 0; g <= 50; g += 2.5) {
      const s = gainStep(g)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
    expect(gainStep(49.6)).toBeGreaterThanOrEqual(28)
  })

  it('picks the multiplexer band', () => {
    expect(muxIndex(3.57e6 + 10e6)).toBe(0)
    expect(muxIndex(100e6 + IF_FREQ)).toBe(7)
    expect(muxIndex(1090e6)).toBe(14)
  })

  it('computes the sample-rate divider', () => {
    expect(sampleRateRatio(2048000).realRate).toBe(2048000)
    expect(sampleRateRatio(2400000).realRate).toBeGreaterThan(2399000)
    expect(sampleRateRatio(2400000).realRate).toBeLessThan(2401000)
    expect(sampleRateRatio(250000).ratio & 3).toBe(0)
  })
})

describe('RtlSdr against a fake dongle', () => {
  it('initialises an R820T, tunes and streams', async () => {
    const dev = new FakeDongle(0x34)
    const sdr = new RtlSdr(dev)
    await sdr.open({ gain: null })
    expect(dev.claimed).toBe(true)
    expect(sdr.tuner).toBe('R820T/R820T2')
    expect(await sdr.setSampleRate(2048000)).toBe(2048000)
    const f = await sdr.setCenterFrequency(100e6)
    expect(Math.abs(f - 100e6)).toBeLessThan(1000)
    await sdr.setGain(30)
    await sdr.resetBuffer()
    expect((await sdr.readSamples(1024)).length).toBe(2048)
    await sdr.close()
    expect(dev.opened).toBe(false)
    expect(dev.claimed).toBe(false)
    // Tuner registers were written on the R820T I2C address.
    expect(dev.writes.some((w) => w.index === (0x600 | 0x10) && w.value === 0x34)).toBe(true)
  })

  it('detects an R828D at I2C address 0x74', async () => {
    const dev = new FakeDongle(0x74)
    const sdr = new RtlSdr(dev)
    await sdr.open({ gain: 20 })
    expect(sdr.tuner).toBe('R828D')
    await sdr.setCenterFrequency(433.92e6)
    await sdr.close()
  })

  it('reports an unsupported tuner clearly', async () => {
    const dev = new FakeDongle(0x00)
    await expect(new RtlSdr(dev).open()).rejects.toThrow(/Unsupported tuner/)
    expect(dev.opened).toBe(false)
  })
})
