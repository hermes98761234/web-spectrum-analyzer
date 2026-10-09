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

import { R820T } from './r820t'
import { BLOCK, CMD, REG, RtlCom, type UsbDeviceLike, type WriteOp } from './rtlcom'

/** Frequency of the oscillator crystal. */
export const XTAL_FREQ = 28800000
/** Tuner intermediate frequency. */
export const IF_FREQ = 3570000
const BYTES_PER_SAMPLE = 2

/** Sample-rate divider register value and the rate it really produces. */
export function sampleRateRatio(rate: number): { ratio: number; realRate: number } {
  let ratio = Math.floor((XTAL_FREQ * 2 ** 22) / rate)
  ratio &= 0x0ffffffc
  return { ratio, realRate: Math.floor((XTAL_FREQ * 2 ** 22) / ratio) }
}

/** Operations on the RTL2832U demodulator chip. */
export class RTL2832U {
  readonly com: RtlCom
  private readonly ppm: number
  private tuner: R820T | null = null

  constructor(dev: UsbDeviceLike, ppm = 0) {
    this.com = new RtlCom(dev)
    this.ppm = ppm
  }

  get tunerName(): string {
    return this.tuner ? (this.tuner.isR828D ? 'R828D' : 'R820T/R820T2') : 'none'
  }

  /** Initialises the chip and tuner. `gain` in dB, or null/undefined for automatic gain. */
  async open(gain?: number | null): Promise<void> {
    const com = this.com
    await com.writeEach([
      [CMD.REG, BLOCK.USB, REG.SYSCTL, 0x09, 1],
      [CMD.REG, BLOCK.USB, REG.EPA_MAXPKT, 0x0200, 2],
      [CMD.REG, BLOCK.USB, REG.EPA_CTL, 0x0210, 2],
    ])
    await com.claim()
    const fir = [0xca, 0xdc, 0xd7, 0xd8, 0xe0, 0xf2, 0x0e, 0x35, 0x06, 0x50, 0x9c, 0x0d, 0x71, 0x11, 0x14, 0x71, 0x74, 0x19, 0x41, 0xa5]
    const ops: WriteOp[] = [
      [CMD.REG, BLOCK.SYS, REG.DEMOD_CTL_1, 0x22, 1],
      [CMD.REG, BLOCK.SYS, REG.DEMOD_CTL, 0xe8, 1],
      [CMD.DEMODREG, 1, 0x01, 0x14, 1],
      [CMD.DEMODREG, 1, 0x01, 0x10, 1],
      [CMD.DEMODREG, 1, 0x15, 0x00, 1],
      [CMD.DEMODREG, 1, 0x16, 0x0000, 2],
      [CMD.DEMODREG, 1, 0x16, 0x00, 1],
      [CMD.DEMODREG, 1, 0x17, 0x00, 1],
      [CMD.DEMODREG, 1, 0x18, 0x00, 1],
      [CMD.DEMODREG, 1, 0x19, 0x00, 1],
      [CMD.DEMODREG, 1, 0x1a, 0x00, 1],
      [CMD.DEMODREG, 1, 0x1b, 0x00, 1],
      ...fir.map((v, i): WriteOp => [CMD.DEMODREG, 1, 0x1c + i, v, 1]),
      [CMD.DEMODREG, 0, 0x19, 0x05, 1],
      [CMD.DEMODREG, 1, 0x93, 0xf0, 1],
      [CMD.DEMODREG, 1, 0x94, 0x0f, 1],
      [CMD.DEMODREG, 1, 0x11, 0x00, 1],
      [CMD.DEMODREG, 1, 0x04, 0x00, 1],
      [CMD.DEMODREG, 0, 0x61, 0x60, 1],
      [CMD.DEMODREG, 0, 0x06, 0x80, 1],
      [CMD.DEMODREG, 1, 0xb1, 0x1b, 1],
      [CMD.DEMODREG, 0, 0x0d, 0x83, 1],
    ]
    await com.writeEach(ops)

    const xtalFreq = Math.floor(XTAL_FREQ * (1 + this.ppm / 1000000))
    await com.openI2C()
    const addr = await R820T.detect(com)
    if (addr === null) {
      throw new Error('Unsupported tuner chip: only R820T/R820T2/R828D dongles are supported (no Elonics E4000, FC0012/13 etc.).')
    }
    this.tuner = new R820T(com, xtalFreq, addr)
    const multiplier = -1 * Math.floor((IF_FREQ * 2 ** 22) / xtalFreq)
    await com.writeEach([
      [CMD.DEMODREG, 1, 0xb1, 0x1a, 1],
      [CMD.DEMODREG, 0, 0x08, 0x4d, 1],
      [CMD.DEMODREG, 1, 0x19, (multiplier >> 16) & 0x3f, 1],
      [CMD.DEMODREG, 1, 0x1a, (multiplier >> 8) & 0xff, 1],
      [CMD.DEMODREG, 1, 0x1b, multiplier & 0xff, 1],
      [CMD.DEMODREG, 1, 0x15, 0x01, 1],
    ])
    await this.tuner.init()
    await this.applyGain(gain)
    await com.closeI2C()
  }

  private async applyGain(gain?: number | null): Promise<void> {
    if (!this.tuner) throw new Error('Device is not open')
    if (gain == null) await this.tuner.setAutoGain()
    else await this.tuner.setManualGain(gain)
  }

  async setGain(gain?: number | null): Promise<void> {
    await this.com.openI2C()
    try {
      await this.applyGain(gain)
    } finally {
      await this.com.closeI2C()
    }
  }

  /** Sets the sample rate (Hz); returns the rate actually programmed. */
  async setSampleRate(rate: number): Promise<number> {
    const { ratio, realRate } = sampleRateRatio(rate)
    const ppmOffset = -1 * Math.floor((this.ppm * 2 ** 24) / 1000000)
    await this.com.writeEach([
      [CMD.DEMODREG, 1, 0x9f, (ratio >> 16) & 0xffff, 2],
      [CMD.DEMODREG, 1, 0xa1, ratio & 0xffff, 2],
      [CMD.DEMODREG, 1, 0x3e, (ppmOffset >> 8) & 0x3f, 1],
      [CMD.DEMODREG, 1, 0x3f, ppmOffset & 0xff, 1],
      [CMD.DEMODREG, 1, 0x01, 0x14, 1],
      [CMD.DEMODREG, 1, 0x01, 0x10, 1],
    ])
    return realRate
  }

  /** Tunes to `freq` Hz; returns the actual centre frequency. */
  async setCenterFrequency(freq: number): Promise<number> {
    if (!this.tuner) throw new Error('Device is not open')
    await this.com.openI2C()
    try {
      return (await this.tuner.setFrequency(freq + IF_FREQ)) - IF_FREQ
    } finally {
      await this.com.closeI2C()
    }
  }

  /** Flushes the endpoint FIFO; call before reading samples. */
  async resetBuffer(): Promise<void> {
    await this.com.writeEach([
      [CMD.REG, BLOCK.USB, REG.EPA_CTL, 0x0210, 2],
      [CMD.REG, BLOCK.USB, REG.EPA_CTL, 0x0000, 2],
    ])
  }

  /** Reads `length` samples as interleaved unsigned 8-bit I/Q bytes. */
  readSamples(length: number): Promise<Uint8Array> {
    return this.com.readBulk(length * BYTES_PER_SAMPLE)
  }

  async close(): Promise<void> {
    if (this.tuner) {
      await this.com.openI2C()
      await this.tuner.close()
      await this.com.closeI2C()
    }
    await this.com.release()
  }
}
