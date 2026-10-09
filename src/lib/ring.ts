/** Fixed-capacity ring buffer of complex samples; real sources leave `im` at zero. */
export class ComplexRing {
  readonly capacity: number
  readonly re: Float32Array
  readonly im: Float32Array
  /** Total number of samples ever pushed. */
  written = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.re = new Float32Array(capacity)
    this.im = new Float32Array(capacity)
  }

  clear(): void {
    this.written = 0
    this.re.fill(0)
    this.im.fill(0)
  }

  /** Push real samples (imaginary part 0). */
  pushReal(x: ArrayLike<number>): void {
    for (let i = 0; i < x.length; i++) {
      const p = this.written % this.capacity
      this.re[p] = x[i]
      this.im[p] = 0
      this.written++
    }
  }

  /** Push separate I and Q arrays. */
  pushComplex(i: ArrayLike<number>, q: ArrayLike<number>): void {
    const n = Math.min(i.length, q.length)
    for (let k = 0; k < n; k++) {
      const p = this.written % this.capacity
      this.re[p] = i[k]
      this.im[p] = q[k]
      this.written++
    }
  }

  /** Copy the most recent n samples (oldest first) to outRe/outIm. False if fewer than n are available. */
  latest(n: number, outRe: Float32Array, outIm: Float32Array): boolean {
    if (n > this.capacity || this.written < n) return false
    const start = this.written - n
    for (let k = 0; k < n; k++) {
      const p = (start + k) % this.capacity
      outRe[k] = this.re[p]
      outIm[k] = this.im[p]
    }
    return true
  }
}
