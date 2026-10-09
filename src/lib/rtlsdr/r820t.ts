// Ported to TypeScript from rtlsdrjs (https://github.com/sandeepmistry/rtlsdrjs), itself based on
// Google's Radio Receiver Chrome app (https://github.com/google/radioreceiver).
// Copyright 2013 Google Inc. All rights reserved.
// Copyright 2018 Sandeep Mistry. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { CMD, type RtlCom } from './rtlcom'

/** Initial values for registers 0x05-0x1f. */
const REGISTERS = [
  0x83, 0x32, 0x75, 0xc0, 0x40, 0xd6, 0x6c, 0xf5, 0x63, 0x75, 0x68, 0x6c, 0x83, 0x80, 0x00, 0x0f, 0x00, 0xc0, 0x30, 0x48, 0xcc, 0x60, 0x00, 0x54, 0xae,
  0x4a, 0xc0,
]

/** Multiplexer settings per band: [lower edge MHz, reg 0x17 value, reg 0x1a value, reg 0x1b value]. */
const MUX_CFGS: number[][] = [
  [0, 0x08, 0x02, 0xdf],
  [50, 0x08, 0x02, 0xbe],
  [55, 0x08, 0x02, 0x8b],
  [60, 0x08, 0x02, 0x7b],
  [65, 0x08, 0x02, 0x69],
  [70, 0x08, 0x02, 0x58],
  [75, 0x00, 0x02, 0x44],
  [90, 0x00, 0x02, 0x34],
  [110, 0x00, 0x02, 0x24],
  [140, 0x00, 0x02, 0x14],
  [180, 0x00, 0x02, 0x13],
  [250, 0x00, 0x02, 0x11],
  [280, 0x00, 0x02, 0x00],
  [310, 0x00, 0x41, 0x00],
  [588, 0x00, 0x40, 0x00],
]

const BIT_REVS = [0x0, 0x8, 0x4, 0xc, 0x2, 0xa, 0x6, 0xe, 0x1, 0x9, 0x5, 0xd, 0x3, 0xb, 0x7, 0xf]

/** I²C addresses: R820T/R820T2/R860 at 0x34, R828D (RTL-SDR Blog V3, many "dual" sticks) at 0x74. */
export const R820T_ADDR = 0x34
export const R828D_ADDR = 0x74

type MaskOp = [reg: number, value: number, mask: number]

/** Index into MUX_CFGS for a tuner frequency in Hz. */
export function muxIndex(freqHz: number): number {
  const mhz = freqHz / 1e6
  let i = 0
  for (; i < MUX_CFGS.length - 1; i++) if (mhz < MUX_CFGS[i + 1][0]) break
  return i
}

/** Maps a requested gain in dB (0..~50) to the tuner's LNA/mixer step (0..30). */
export function gainStep(gain: number): number {
  const step =
    gain <= 15
      ? Math.round(1.36 + gain * (1.1118 + gain * (-0.0786 + gain * 0.0027)))
      : Math.round(1.2068 + gain * (0.6875 + gain * (-0.01011 + gain * 0.0001587)))
  return Math.max(0, Math.min(30, step))
}

/** Reverses the bit order of each byte (the tuner returns its registers bit-reversed). */
export function reverseBits(b: number): number {
  return (BIT_REVS[b & 0xf] << 4) | BIT_REVS[b >> 4]
}

/** Operations on the R820T / R828D tuner chip. */
export class R820T {
  private readonly com: RtlCom
  private readonly xtalFreq: number
  private readonly addr: number
  private hasPllLock = false
  private shadowRegs: Uint8Array = new Uint8Array(REGISTERS)
  private input = -1

  constructor(com: RtlCom, xtalFreq: number, addr = R820T_ADDR) {
    this.com = com
    this.xtalFreq = xtalFreq
    this.addr = addr
  }

  /** Detects the tuner: returns its I²C address, or null. Chip ID register 0 reads 0x69 (0x96 bit-reversed). */
  static async detect(com: RtlCom): Promise<number | null> {
    for (const addr of [R820T_ADDR, R828D_ADDR]) {
      try {
        if ((await com.readI2CReg(addr, 0)) === 0x69) return addr
      } catch {
        // No device at this address: try the next one.
      }
    }
    return null
  }

  get isR828D(): boolean {
    return this.addr === R828D_ADDR
  }

  async init(): Promise<void> {
    await this.initRegisters(REGISTERS)
    await this.initElectronics()
  }

  /** Tunes to `freq` (the tuner frequency, i.e. including the IF offset). Returns the actual frequency. */
  async setFrequency(freq: number): Promise<number> {
    await this.setMux(freq)
    if (this.isR828D) {
      // Dual-input R828D: "Air-In" above 345 MHz, "Cable 1" below.
      const input = freq > 345e6 ? 0x00 : 0x60
      if (input !== this.input) {
        this.input = input
        await this.writeRegMask(0x05, input, 0x60)
      }
    }
    return this.setPll(freq)
  }

  async close(): Promise<void> {
    await this.writeEach([
      [0x06, 0xb1, 0xff],
      [0x05, 0xb3, 0xff],
      [0x07, 0x3a, 0xff],
      [0x08, 0x40, 0xff],
      [0x09, 0xc0, 0xff],
      [0x0a, 0x36, 0xff],
      [0x0c, 0x35, 0xff],
      [0x0f, 0x68, 0xff],
      [0x11, 0x03, 0xff],
      [0x17, 0xf4, 0xff],
      [0x19, 0x0c, 0xff],
    ])
  }

  private async initElectronics(): Promise<void> {
    await this.writeEach([
      [0x0c, 0x00, 0x0f],
      [0x13, 49, 0x3f],
      [0x1d, 0x00, 0x38],
    ])
    const filterCap = await this.calibrateFilter(true)
    await this.writeEach([
      [0x0a, 0x10 | filterCap, 0x1f],
      [0x0b, 0x6b, 0xef],
      [0x07, 0x00, 0x80],
      [0x06, 0x10, 0x30],
      [0x1e, 0x40, 0x60],
      [0x05, 0x00, 0x80],
      [0x1f, 0x00, 0x80],
      [0x0f, 0x00, 0x80],
      [0x19, 0x60, 0x60],
      [0x1d, 0xe5, 0xc7],
      [0x1c, 0x24, 0xf8],
      [0x0d, 0x53, 0xff],
      [0x0e, 0x75, 0xff],
      [0x05, 0x00, 0x60],
      [0x06, 0x00, 0x08],
      [0x11, 0x38, 0x08],
      [0x17, 0x30, 0x30],
      [0x0a, 0x40, 0x60],
      [0x1d, 0x00, 0x38],
      [0x1c, 0x00, 0x04],
      [0x06, 0x00, 0x40],
      [0x1a, 0x30, 0x30],
      [0x1d, 0x18, 0x38],
      [0x1c, 0x24, 0x04],
      [0x1e, 0x0d, 0x1f],
      [0x1a, 0x20, 0x30],
    ])
  }

  async setAutoGain(): Promise<void> {
    await this.writeEach([
      [0x05, 0x00, 0x10],
      [0x07, 0x10, 0x10],
      [0x0c, 0x0b, 0x9f],
    ])
  }

  /** Manual gain in dB. */
  async setManualGain(gain: number): Promise<void> {
    const step = gainStep(gain)
    const lna = Math.floor(step / 2)
    const mixer = Math.floor((step - 1) / 2)
    await this.writeEach([
      [0x05, 0x10, 0x10],
      [0x07, 0x00, 0x10],
      [0x0c, 0x08, 0x9f],
      [0x05, lna, 0x0f],
      [0x07, mixer, 0x0f],
    ])
  }

  private async calibrateFilter(firstTry: boolean): Promise<number> {
    await this.writeEach([
      [0x0b, 0x6b, 0x60],
      [0x0f, 0x04, 0x04],
      [0x10, 0x00, 0x03],
    ])
    await this.setPll(56000000)
    if (!this.hasPllLock) throw new Error('Tuner PLL did not lock while calibrating the filter.')
    await this.writeEach([
      [0x0b, 0x10, 0x10],
      [0x0b, 0x00, 0x10],
      [0x0f, 0x00, 0x04],
    ])
    const arr = await this.readRegBuffer(0x00, 5)
    let filterCap = arr[4] & 0x0f
    if (filterCap === 0x0f) filterCap = 0
    if (filterCap !== 0 && firstTry) return this.calibrateFilter(false)
    return filterCap
  }

  private async setMux(freq: number): Promise<void> {
    const cfg = MUX_CFGS[muxIndex(freq)]
    await this.writeEach([
      [0x17, cfg[1], 0x08],
      [0x1a, cfg[2], 0xc3],
      [0x1b, cfg[3], 0xff],
      [0x10, 0x00, 0x0b],
      [0x08, 0x00, 0x3f],
      [0x09, 0x00, 0x3f],
    ])
  }

  private async setPll(freq: number): Promise<number> {
    const pllRef = Math.floor(this.xtalFreq)
    await this.writeEach([
      [0x10, 0x00, 0x10],
      [0x1a, 0x00, 0x0c],
      [0x12, 0x80, 0xe0],
    ])
    let divNum = Math.min(6, Math.floor(Math.log(1770000000 / freq) / Math.LN2))
    const mixDiv = 1 << (divNum + 1)
    const arr = await this.readRegBuffer(0x00, 5)
    const vcoFineTune = (arr[4] & 0x30) >> 4
    if (vcoFineTune > 2) --divNum
    else if (vcoFineTune < 2) ++divNum
    await this.writeRegMask(0x10, divNum << 5, 0xe0)
    const vcoFreq = freq * mixDiv
    const nint = Math.floor(vcoFreq / (2 * pllRef))
    const vcoFra = vcoFreq % (2 * pllRef)
    if (nint > 63) {
      this.hasPllLock = false
      throw new Error(`Frequency ${(freq / 1e6).toFixed(3)} MHz is outside the tuner's range.`)
    }
    const ni = Math.floor((nint - 13) / 4)
    const si = (nint - 13) % 4
    await this.writeEach([
      [0x14, ni + (si << 6), 0xff],
      [0x12, vcoFra === 0 ? 0x08 : 0x00, 0x08],
    ])
    const sdm = Math.min(65535, Math.floor((32768 * vcoFra) / pllRef))
    await this.writeEach([
      [0x16, sdm >> 8, 0xff],
      [0x15, sdm & 0xff, 0xff],
    ])
    await this.getPllLock(true)
    await this.writeRegMask(0x1a, 0x08, 0x08)
    return (2 * pllRef * (nint + sdm / 65536)) / mixDiv
  }

  get locked(): boolean {
    return this.hasPllLock
  }

  private async getPllLock(firstTry: boolean): Promise<void> {
    const arr = await this.readRegBuffer(0x00, 3)
    if (arr[2] & 0x40) {
      this.hasPllLock = true
      return
    }
    if (firstTry) {
      await this.writeRegMask(0x12, 0x60, 0xe0)
      return this.getPllLock(false)
    }
    this.hasPllLock = false
  }

  private async initRegisters(regs: number[]): Promise<void> {
    this.shadowRegs = new Uint8Array(regs)
    const cmds = regs.map((v, i) => [CMD.I2CREG, this.addr, i + 5, v] as [4, number, number, number])
    await this.com.writeEach(cmds)
  }

  private async readRegBuffer(addr: number, length: number): Promise<Uint8Array> {
    const buf = await this.com.readI2CRegBuffer(this.addr, addr, length)
    for (let i = 0; i < buf.length; i++) buf[i] = reverseBits(buf[i])
    return buf
  }

  private async writeRegMask(addr: number, value: number, mask: number): Promise<void> {
    const rc = this.shadowRegs[addr - 5]
    const val = (rc & ~mask) | (value & mask)
    this.shadowRegs[addr - 5] = val
    await this.com.writeI2CReg(this.addr, addr, val)
  }

  private async writeEach(ops: MaskOp[]): Promise<void> {
    for (const [reg, value, mask] of ops) await this.writeRegMask(reg, value, mask)
  }
}
