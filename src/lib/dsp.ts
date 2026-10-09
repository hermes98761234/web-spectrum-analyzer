/** Convert interleaved unsigned 8-bit IQ (RTL-SDR) to float I/Q in [-1, 1). Returns the sample count. */
export function iqFromU8(bytes: Uint8Array, i: Float32Array, q: Float32Array): number {
  const n = bytes.length >> 1
  for (let k = 0; k < n; k++) {
    i[k] = (bytes[2 * k] - 127.5) / 127.5
    q[k] = (bytes[2 * k + 1] - 127.5) / 127.5
  }
  return n
}

/** Subtract the mean of each channel (kills the zero-frequency spike of direct-conversion receivers). */
export function removeDc(i: Float32Array, q: Float32Array, n = i.length): void {
  let si = 0
  let sq = 0
  for (let k = 0; k < n; k++) {
    si += i[k]
    sq += q[k]
  }
  si /= n
  sq /= n
  for (let k = 0; k < n; k++) {
    i[k] -= si
    q[k] -= sq
  }
}

export function rms(x: ArrayLike<number>): number {
  let s = 0
  for (let k = 0; k < x.length; k++) s += x[k] * x[k]
  return Math.sqrt(s / x.length)
}
