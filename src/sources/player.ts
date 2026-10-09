/** Plays demodulated mono audio chunks gaplessly through Web Audio. */
export class AudioPlayer {
  static readonly RATE = 48000
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private next = 0
  private volume = 0.7

  get active(): boolean {
    return this.ctx !== null
  }

  /** Must be called from a user gesture. */
  async start(): Promise<void> {
    if (this.ctx) return
    this.ctx = new AudioContext({ sampleRate: AudioPlayer.RATE })
    this.gain = this.ctx.createGain()
    this.gain.gain.value = this.volume
    this.gain.connect(this.ctx.destination)
    await this.ctx.resume()
    this.next = 0
  }

  setVolume(v: number): void {
    this.volume = v
    if (this.gain) this.gain.gain.value = v
  }

  push(samples: Float32Array): void {
    const ctx = this.ctx
    if (!ctx || !this.gain || samples.length === 0) return
    const buf = ctx.createBuffer(1, samples.length, AudioPlayer.RATE)
    buf.copyToChannel(new Float32Array(samples), 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.gain)
    const now = ctx.currentTime
    if (this.next < now + 0.02) this.next = now + 0.1 // underrun: re-buffer
    else if (this.next > now + 0.6) return // overrun: drop to keep latency low
    src.start(this.next)
    this.next += samples.length / AudioPlayer.RATE
  }

  async stop(): Promise<void> {
    await this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.gain = null
  }
}
