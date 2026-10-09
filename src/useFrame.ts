import { useEffect, useState } from 'react'
import type { Engine, FrameEvent, Status } from './engine'

/** Latest analysis frame, re-rendered at most every `ms` milliseconds (for text readouts, not canvases). */
export function useFrame(engine: Engine, ms = 250): FrameEvent | null {
  const [ev, setEv] = useState<FrameEvent | null>(engine.last)
  useEffect(() => {
    let last = 0
    return engine.subscribe((e) => {
      const now = performance.now()
      if (now - last >= ms) {
        last = now
        setEv(e)
      }
    })
  }, [engine, ms])
  return ev
}

export function useStatus(engine: Engine): { status: Status; error: string } {
  const [, bump] = useState(0)
  useEffect(() => engine.onStatus(() => bump((n) => n + 1)), [engine])
  return { status: engine.status, error: engine.error }
}
