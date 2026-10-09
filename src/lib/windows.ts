export type WindowKind = 'rectangular' | 'hann' | 'hamming' | 'blackman-harris' | 'flat-top'

export const WINDOWS: WindowKind[] = ['hann', 'hamming', 'blackman-harris', 'flat-top', 'rectangular']

/** Cosine-sum coefficients a0, a1, a2, ... (periodic form, w[n] = Σ (-1)^k a_k cos(2πkn/N)). */
const COEFFS: Record<WindowKind, number[]> = {
  rectangular: [1],
  hann: [0.5, 0.5],
  hamming: [0.54, 0.46],
  'blackman-harris': [0.35875, 0.48829, 0.14128, 0.01168],
  // ISO 18431-2 / SRS flat-top
  'flat-top': [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368],
}

/** Periodic (DFT-even) window of length n: the right choice for spectral analysis. */
export function makeWindow(kind: WindowKind, n: number): Float32Array {
  const c = COEFFS[kind]
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let v = 0
    for (let k = 0; k < c.length; k++) v += (k % 2 ? -1 : 1) * c[k] * Math.cos((2 * Math.PI * k * i) / n)
    w[i] = v
  }
  return w
}

/** Coherent gain: mean of the window. A tone's FFT peak is scaled by this. */
export function coherentGain(w: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < w.length; i++) s += w[i]
  return s / w.length
}

/** Equivalent noise bandwidth in bins: N·Σw² / (Σw)². */
export function enbw(w: ArrayLike<number>): number {
  let s = 0
  let s2 = 0
  for (let i = 0; i < w.length; i++) {
    s += w[i]
    s2 += w[i] * w[i]
  }
  return (w.length * s2) / (s * s)
}
