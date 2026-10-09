/** A producer of samples. Real sources deliver `im === null`. */
export interface Source {
  readonly iq: boolean
  /** Valid after start(). */
  sampleRate: number
  centerFreq: number
  onBlock: (re: Float32Array, im: Float32Array | null) => void
  onError: (message: string) => void
  start(): Promise<void>
  stop(): Promise<void>
}
