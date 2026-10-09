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

import { RTL_FILTERS, type UsbDeviceLike } from './rtlcom'
import { RTL2832U } from './rtl2832u'

interface NavigatorUsb {
  requestDevice(options: { filters: typeof RTL_FILTERS }): Promise<UsbDeviceLike>
  getDevices(): Promise<UsbDeviceLike[]>
}

function usbApi(): NavigatorUsb | null {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { usb?: NavigatorUsb })
  return nav?.usb ?? null
}

/** True when this browser exposes WebUSB (Chromium-based browsers over HTTPS or localhost). */
export function isWebUsbSupported(): boolean {
  return usbApi() !== null && (typeof isSecureContext === 'undefined' || isSecureContext)
}

/** Why WebUSB is unavailable, or null if it is available. */
export function webUsbProblem(): 'insecure' | 'unsupported' | null {
  if (usbApi() === null) return typeof isSecureContext !== 'undefined' && !isSecureContext ? 'insecure' : 'unsupported'
  if (typeof isSecureContext !== 'undefined' && !isSecureContext) return 'insecure'
  return null
}

export interface OpenOptions {
  ppm?: number
  /** Gain in dB; null for automatic. */
  gain?: number | null
}

/** A connected RTL-SDR dongle. */
export class RtlSdr {
  private readonly device: UsbDeviceLike
  private rtl: RTL2832U | null = null

  constructor(device: UsbDeviceLike) {
    this.device = device
  }

  /** Shows the browser's device picker (must be called from a user gesture). */
  static async requestDevice(): Promise<RtlSdr> {
    const usb = usbApi()
    if (!usb) throw new Error('WebUSB is not available in this browser.')
    return new RtlSdr(await usb.requestDevice({ filters: RTL_FILTERS }))
  }

  /** Dongles the user already granted access to. */
  static async getDevices(): Promise<RtlSdr[]> {
    const usb = usbApi()
    if (!usb) return []
    const devs = await usb.getDevices()
    return devs.filter((d) => RTL_FILTERS.some((f) => f.vendorId === d.vendorId && f.productId === d.productId)).map((d) => new RtlSdr(d))
  }

  get name(): string {
    return this.device.productName || 'RTL2832U'
  }

  get tuner(): string {
    return this.rtl?.tunerName ?? 'none'
  }

  async open(options: OpenOptions = {}): Promise<void> {
    await this.device.open()
    try {
      await this.device.selectConfiguration(1)
      this.rtl = new RTL2832U(this.device, options.ppm ?? 0)
      await this.rtl.open(options.gain ?? null)
    } catch (e) {
      await this.device.close().catch(() => undefined)
      this.rtl = null
      throw e
    }
  }

  private get r(): RTL2832U {
    if (!this.rtl) throw new Error('Device is not open')
    return this.rtl
  }

  setSampleRate(rate: number): Promise<number> {
    return this.r.setSampleRate(rate)
  }

  setCenterFrequency(freq: number): Promise<number> {
    return this.r.setCenterFrequency(freq)
  }

  setGain(gain: number | null): Promise<void> {
    return this.r.setGain(gain)
  }

  resetBuffer(): Promise<void> {
    return this.r.resetBuffer()
  }

  readSamples(length: number): Promise<Uint8Array> {
    return this.r.readSamples(length)
  }

  async close(): Promise<void> {
    if (!this.rtl) return
    const r = this.rtl
    this.rtl = null
    try {
      await r.close()
    } finally {
      await this.device.close()
    }
  }
}
