import type { Source } from './types'

/** AudioWorklet that forwards the mono-mixed input in 512-frame blocks. */
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(512); this.n = 0 }
  process(inputs) {
    const inp = inputs[0]
    if (inp && inp.length) {
      const a = inp[0], b = inp.length > 1 ? inp[1] : null
      for (let i = 0; i < a.length; i++) {
        this.buf[this.n++] = b ? 0.5 * (a[i] + b[i]) : a[i]
        if (this.n === 512) { this.port.postMessage(this.buf); this.buf = new Float32Array(512); this.n = 0 }
      }
    }
    return true
  }
}
registerProcessor('tap', Tap)
`

async function createTap(ctx: AudioContext, onBlock: Source['onBlock']): Promise<AudioWorkletNode> {
  if (!ctx.audioWorklet) throw new Error('AudioWorklet is not available (it needs a secure context: HTTPS or localhost).')
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  const tap = new AudioWorkletNode(ctx, 'tap', { numberOfOutputs: 1, outputChannelCount: [1] })
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => onBlock(e.data, null)
  // Keep the node in the render graph without making any sound.
  const mute = ctx.createGain()
  mute.gain.value = 0
  tap.connect(mute).connect(ctx.destination)
  return tap
}

/** Microphone / line input. Echo cancellation, noise suppression and AGC are off: they distort spectra. */
export class MicSource implements Source {
  readonly iq = false
  sampleRate = 48000
  centerFreq = 0
  onBlock: Source['onBlock'] = () => {}
  onError: Source['onError'] = () => {}
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not available (it needs HTTPS or localhost).')
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    })
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    await ctx.resume()
    this.sampleRate = ctx.sampleRate
    const tap = await createTap(ctx, (re, im) => this.onBlock(re, im))
    ctx.createMediaStreamSource(this.stream).connect(tap)
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    await this.ctx?.close().catch(() => undefined)
    this.ctx = null
  }
}

/** Audio file playback through an <audio> element (looping), tapped for analysis. */
export class FileSource implements Source {
  readonly iq = false
  sampleRate = 48000
  centerFreq = 0
  onBlock: Source['onBlock'] = () => {}
  onError: Source['onError'] = () => {}
  readonly element: HTMLAudioElement
  private ctx: AudioContext | null = null
  private url: string

  constructor(file: File) {
    this.url = URL.createObjectURL(file)
    this.element = new Audio(this.url)
    this.element.controls = true
    this.element.loop = true
    this.element.addEventListener('error', () => this.onError('This file could not be decoded as audio.'))
  }

  async start(): Promise<void> {
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    this.sampleRate = ctx.sampleRate
    const tap = await createTap(ctx, (re, im) => this.onBlock(re, im))
    const src = ctx.createMediaElementSource(this.element)
    src.connect(tap)
    src.connect(ctx.destination)
    await ctx.resume()
    await this.element.play().catch(() => undefined)
  }

  async stop(): Promise<void> {
    this.element.pause()
    await this.ctx?.close().catch(() => undefined)
    this.ctx = null
    URL.revokeObjectURL(this.url)
  }
}
