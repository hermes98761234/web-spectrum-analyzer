/** In-place iterative radix-2 complex FFT with cached twiddles and bit-reversal table. */
export class FFT {
  readonly size: number
  private readonly cos: Float64Array
  private readonly sin: Float64Array
  private readonly rev: Uint32Array

  constructor(size: number) {
    if (!isPowerOfTwo(size) || size < 2) throw new Error(`FFT size must be a power of two >= 2, got ${size}`)
    this.size = size
    const half = size / 2
    this.cos = new Float64Array(half)
    this.sin = new Float64Array(half)
    for (let i = 0; i < half; i++) {
      const a = (-2 * Math.PI * i) / size
      this.cos[i] = Math.cos(a)
      this.sin[i] = Math.sin(a)
    }
    this.rev = new Uint32Array(size)
    const bits = Math.log2(size)
    for (let i = 0; i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b)
      this.rev[i] = r
    }
  }

  /** Forward transform X[k] = sum x[n] e^{-j2πkn/N}, unnormalised, in place. */
  forward(re: Float32Array | Float64Array, im: Float32Array | Float64Array): void {
    const n = this.size
    if (re.length < n || im.length < n) throw new Error('FFT buffers are shorter than the FFT size')
    const rev = this.rev
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        const tr = re[i]
        re[i] = re[j]
        re[j] = tr
        const ti = im[i]
        im[i] = im[j]
        im[j] = ti
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1
      const step = n / len
      for (let start = 0; start < n; start += len) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const wr = this.cos[t]
          const wi = this.sin[t]
          const a = start + k
          const b = a + half
          const xr = re[b] * wr - im[b] * wi
          const xi = re[b] * wi + im[b] * wr
          re[b] = re[a] - xr
          im[b] = im[a] - xi
          re[a] += xr
          im[a] += xi
        }
      }
    }
  }
}

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0
}

const cache = new Map<number, FFT>()
/** Shared FFT instances, so changing the size back and forth does not recompute tables. */
export function getFFT(size: number): FFT {
  let f = cache.get(size)
  if (!f) {
    f = new FFT(size)
    cache.set(size, f)
  }
  return f
}

/** Straightforward O(N²) DFT, used as a reference in tests. */
export function dft(re: ArrayLike<number>, im: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const n = re.length
  const or = new Float64Array(n)
  const oi = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    let sr = 0
    let si = 0
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n
      const c = Math.cos(a)
      const s = Math.sin(a)
      sr += re[t] * c - im[t] * s
      si += re[t] * s + im[t] * c
    }
    or[k] = sr
    oi[k] = si
  }
  return { re: or, im: oi }
}
