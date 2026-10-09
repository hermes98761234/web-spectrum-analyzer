export type ColormapName = 'viridis' | 'inferno' | 'turbo' | 'sdr' | 'gray'

export const COLORMAPS: ColormapName[] = ['viridis', 'inferno', 'turbo', 'sdr', 'gray']

type RGB = [number, number, number]

/** Evenly spaced control points; the lookup table interpolates linearly between them. */
const STOPS: Record<ColormapName, RGB[]> = {
  viridis: [[68, 1, 84], [72, 36, 117], [65, 68, 135], [53, 95, 141], [42, 120, 142], [34, 168, 132], [68, 191, 112], [122, 209, 81], [189, 223, 38], [253, 231, 37]],
  inferno: [[0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106], [186, 54, 85], [227, 89, 51], [249, 140, 10], [249, 201, 50], [252, 255, 164]],
  turbo: [[48, 18, 59], [70, 107, 227], [40, 187, 236], [49, 242, 153], [164, 252, 60], [237, 207, 58], [251, 126, 33], [203, 42, 5], [122, 4, 3]],
  // The classic SDR look: black → blue → cyan → yellow → red → white.
  sdr: [[0, 0, 0], [0, 0, 128], [0, 90, 255], [0, 220, 220], [255, 255, 0], [255, 120, 0], [255, 0, 0], [255, 255, 255]],
  gray: [[0, 0, 0], [255, 255, 255]],
}

/** 256-entry RGBA lookup table (Uint8ClampedArray of 1024 bytes). */
export function makeLut(name: ColormapName): Uint8ClampedArray {
  const s = STOPS[name]
  const lut = new Uint8ClampedArray(256 * 4)
  for (let i = 0; i < 256; i++) {
    const p = (i / 255) * (s.length - 1)
    const k = Math.min(s.length - 2, Math.floor(p))
    const t = p - k
    for (let c = 0; c < 3; c++) lut[i * 4 + c] = Math.round(s[k][c] + (s[k + 1][c] - s[k][c]) * t)
    lut[i * 4 + 3] = 255
  }
  return lut
}

/** Map dB values to LUT RGBA pixels. */
export function colorize(db: ArrayLike<number>, floor: number, ceiling: number, lut: Uint8ClampedArray, out: Uint8ClampedArray): void {
  const span = Math.max(1e-6, ceiling - floor)
  for (let i = 0; i < db.length; i++) {
    let t = (db[i] - floor) / span
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const idx = (t * 255 + 0.5) | 0
    out[i * 4] = lut[idx * 4]
    out[i * 4 + 1] = lut[idx * 4 + 1]
    out[i * 4 + 2] = lut[idx * 4 + 2]
    out[i * 4 + 3] = 255
  }
}
