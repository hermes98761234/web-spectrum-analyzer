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

/** The subset of the WebUSB `USBDevice` API used here (also lets tests inject a fake dongle). */
export interface UsbDeviceLike {
  readonly vendorId: number
  readonly productId: number
  readonly productName?: string
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(n: number): Promise<void>
  claimInterface(n: number): Promise<void>
  releaseInterface(n: number): Promise<void>
  controlTransferIn(setup: UsbSetup, length: number): Promise<{ data?: DataView; status: string }>
  controlTransferOut(setup: UsbSetup, data?: BufferSource): Promise<{ status: string }>
  transferIn(endpoint: number, length: number): Promise<{ data?: DataView; status: string }>
}

export interface UsbSetup {
  requestType: 'vendor'
  recipient: 'device'
  request: number
  value: number
  index: number
}

/** Realtek RTL2832U USB ids accepted by the device picker. */
export const RTL_FILTERS = [
  { vendorId: 0x0bda, productId: 0x2832 },
  { vendorId: 0x0bda, productId: 0x2838 },
]

export type WriteOp =
  | [cmd: 1, block: number, reg: number, value: number, len: number]
  | [cmd: 2, block: number, reg: number, value: number, mask: number]
  | [cmd: 3, page: number, addr: number, value: number, len: number]
  | [cmd: 4, i2cAddr: number, reg: number, value: number]

export const CMD = { REG: 1, REGMASK: 2, DEMODREG: 3, I2CREG: 4 } as const
export const BLOCK = { DEMOD: 0x000, USB: 0x100, SYS: 0x200, I2C: 0x600 } as const
export const REG = { SYSCTL: 0x2000, EPA_CTL: 0x2148, EPA_MAXPKT: 0x2158, DEMOD_CTL: 0x3000, DEMOD_CTL_1: 0x300b } as const

/** Set in the control messages' index field for write operations. */
const WRITE_FLAG = 0x10

function toBuffer(value: number, len: number, bigEndian = false): ArrayBuffer {
  const buffer = new ArrayBuffer(len)
  const dv = new DataView(buffer)
  if (len === 1) dv.setUint8(0, value)
  else if (len === 2) dv.setUint16(0, value, !bigEndian)
  else if (len === 4) dv.setUint32(0, value, !bigEndian)
  else throw new Error(`Cannot write ${len}-byte number`)
  return buffer
}

function toNumber(bytes: Uint8Array): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length === 1) return dv.getUint8(0)
  if (bytes.length === 2) return dv.getUint16(0, true)
  if (bytes.length === 4) return dv.getUint32(0, true)
  throw new Error(`Cannot parse ${bytes.length}-byte number`)
}

function copyBytes(dv: DataView | undefined, length: number): Uint8Array {
  if (!dv) return new Uint8Array(length)
  return new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + Math.min(length, dv.byteLength)))
}

/** Low-level register access to the dongle over USB vendor control transfers. */
export class RtlCom {
  private readonly dev: UsbDeviceLike

  constructor(dev: UsbDeviceLike) {
    this.dev = dev
  }

  private async ctrlRead(value: number, index: number, length: number): Promise<Uint8Array> {
    const r = await this.dev.controlTransferIn({ requestType: 'vendor', recipient: 'device', request: 0, value, index }, Math.max(8, length))
    if (r.status !== 'ok') throw new Error(`USB read failed (value 0x${value.toString(16)} index 0x${index.toString(16)}): ${r.status}`)
    return copyBytes(r.data, length)
  }

  private async ctrlWrite(value: number, index: number, data: ArrayBuffer): Promise<void> {
    const r = await this.dev.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0, value, index }, data)
    if (r.status !== 'ok') throw new Error(`USB write failed (value 0x${value.toString(16)} index 0x${index.toString(16)}): ${r.status}`)
  }

  writeRegBuffer(block: number, reg: number, buffer: ArrayBuffer): Promise<void> {
    return this.ctrlWrite(reg, block | WRITE_FLAG, buffer)
  }

  readRegBuffer(block: number, reg: number, length: number): Promise<Uint8Array> {
    return this.ctrlRead(reg, block, length)
  }

  writeReg(block: number, reg: number, value: number, length: number): Promise<void> {
    return this.ctrlWrite(reg, block | WRITE_FLAG, toBuffer(value, length))
  }

  async readReg(block: number, reg: number, length: number): Promise<number> {
    return toNumber(await this.ctrlRead(reg, block, length))
  }

  async writeRegMask(block: number, reg: number, value: number, mask: number): Promise<void> {
    if (mask === 0xff) return this.writeReg(block, reg, value, 1)
    const old = await this.readReg(block, reg, 1)
    await this.writeReg(block, reg, (value & mask) | (old & ~mask), 1)
  }

  readDemodReg(page: number, addr: number): Promise<number> {
    return this.readReg(page, (addr << 8) | 0x20, 1)
  }

  async writeDemodReg(page: number, addr: number, value: number, len: number): Promise<number> {
    await this.writeRegBuffer(page, (addr << 8) | 0x20, toBuffer(value, len, true))
    return this.readDemodReg(0x0a, 0x01)
  }

  /** Open the I²C repeater so the host can talk to the tuner. */
  openI2C(): Promise<number> {
    return this.writeDemodReg(1, 1, 0x18, 1)
  }

  closeI2C(): Promise<number> {
    return this.writeDemodReg(1, 1, 0x10, 1)
  }

  async readI2CReg(addr: number, reg: number): Promise<number> {
    await this.writeRegBuffer(BLOCK.I2C, addr, new Uint8Array([reg]).buffer)
    return this.readReg(BLOCK.I2C, addr, 1)
  }

  writeI2CReg(addr: number, reg: number, value: number): Promise<void> {
    return this.writeRegBuffer(BLOCK.I2C, addr, new Uint8Array([reg, value]).buffer)
  }

  async readI2CRegBuffer(addr: number, reg: number, len: number): Promise<Uint8Array> {
    await this.writeRegBuffer(BLOCK.I2C, addr, new Uint8Array([reg]).buffer)
    return this.readRegBuffer(BLOCK.I2C, addr, len)
  }

  async readBulk(length: number): Promise<Uint8Array> {
    const r = await this.dev.transferIn(1, length)
    if (r.status === 'babble') throw new Error('USB bulk read overflow')
    if (r.status === 'stall') throw new Error('USB bulk read stalled')
    if (!r.data) return new Uint8Array(0)
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength)
  }

  claim(): Promise<void> {
    return this.dev.claimInterface(0)
  }

  release(): Promise<void> {
    return this.dev.releaseInterface(0)
  }

  async writeEach(ops: WriteOp[]): Promise<void> {
    for (const op of ops) {
      if (op[0] === CMD.REG) await this.writeReg(op[1], op[2], op[3], op[4])
      else if (op[0] === CMD.REGMASK) await this.writeRegMask(op[1], op[2], op[3], op[4])
      else if (op[0] === CMD.DEMODREG) await this.writeDemodReg(op[1], op[2], op[3], op[4])
      else if (op[0] === CMD.I2CREG) await this.writeI2CReg(op[1], op[2], op[3])
      else throw new Error(`Unsupported operation [${String(op)}]`)
    }
  }
}
