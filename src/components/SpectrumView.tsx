import { useEffect, useRef } from 'react'
import { formatFreq, frameToColumns, freqToX, LOG_FMIN, makeTicks, noteName, panView, xToFreq, zoomView, type View } from '../lib/axis'
import { colorize, makeLut, type ColormapName } from '../lib/colormaps'
import { DB_FLOOR, type Peak } from '../lib/spectrum'
import type { Engine, FrameEvent } from '../engine'
import type { T } from '../i18n'

export interface ViewProps {
  engine: Engine
  logAxis: boolean
  floor: number
  ceiling: number
  colormap: ColormapName
  wfRate: number
  peakHold: boolean
  /** Highlighted demodulator channel, or null. */
  marker: { freq: number; bw: number } | null
  onPick: (freq: number) => void
  t: T
}

const LEFT = 46
const RIGHT = 10
const TOP = 8
const BOTTOM = 22

interface Colors {
  bg: string
  grid: string
  gridStrong: string
  fg: string
  accent: string
  warn: string
}

function readColors(el: Element): Colors {
  const cs = getComputedStyle(el)
  const g = (n: string) => cs.getPropertyValue(n).trim()
  return { bg: g('--chart-bg'), grid: g('--grid'), gridStrong: g('--grid-strong'), fg: g('--chart-fg'), accent: g('--accent'), warn: g('--warn') }
}

function baseView(ev: FrameEvent, log: boolean): View {
  const fs = ev.sampleRate
  if (ev.iq) return { fmin: ev.centerFreq - fs / 2, fmax: ev.centerFreq + fs / 2, log: false }
  return { fmin: log ? LOG_FMIN : 0, fmax: fs / 2, log }
}

/** Spectrum trace plus scrolling waterfall sharing one frequency axis. Drawn imperatively, outside React's render cycle. */
export default function SpectrumView(props: ViewProps) {
  const propsRef = useRef(props)
  useEffect(() => {
    propsRef.current = props
  })
  const wrapRef = useRef<HTMLDivElement>(null)
  const specRef = useRef<HTMLCanvasElement>(null)
  const wfRef = useRef<HTMLCanvasElement>(null)
  const readoutRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const redrawRef = useRef<() => void>(() => {})
  const zoomActions = useRef<{ zoom: (f: number) => void; reset: () => void }>({ zoom: () => {}, reset: () => {} })

  useEffect(() => {
    const wrap = wrapRef.current!
    const spec = specRef.current!
    const wf = wfRef.current!
    const sctx = spec.getContext('2d')!
    const wctx = wf.getContext('2d', { willReadFrequently: false })!
    const st = {
      zoom: null as View | null,
      baseKey: '',
      cursor: null as { x: number; y: number } | null,
      lastRow: 0,
      wfKey: '',
      cols: new Float32Array(0) as Float32Array,
      peakCols: new Float32Array(0) as Float32Array,
      lut: makeLut(propsRef.current.colormap),
      lutName: propsRef.current.colormap,
      row: new Uint8ClampedArray(0),
      rowImg: null as ImageData | null,
      view: null as View | null,
      drag: null as null | { x: number; view: View; moved: boolean },
    }
    const dpr = () => window.devicePixelRatio || 1

    function sizeCanvas(c: HTMLCanvasElement): boolean {
      const w = Math.max(1, Math.round(c.clientWidth * dpr()))
      const h = Math.max(1, Math.round(c.clientHeight * dpr()))
      if (c.width === w && c.height === h) return false
      c.width = w
      c.height = h
      return true
    }

    function currentView(ev: FrameEvent): { view: View; base: View } {
      const p = propsRef.current
      const base = baseView(ev, p.logAxis)
      const key = `${ev.iq}|${ev.sampleRate}|${ev.centerFreq}|${base.log}`
      if (key !== st.baseKey) {
        st.baseKey = key
        st.zoom = null
      }
      return { view: st.zoom ?? base, base }
    }

    function drawSpectrum(): void {
      const ev = propsRef.current.engine.last
      const p = propsRef.current
      sizeCanvas(spec)
      const d = dpr()
      const W = spec.width / d
      const H = spec.height / d
      const col = readColors(wrap)
      sctx.setTransform(d, 0, 0, d, 0, 0)
      sctx.fillStyle = col.bg
      sctx.fillRect(0, 0, W, H)
      const pw = W - LEFT - RIGHT
      const ph = H - TOP - BOTTOM
      if (pw < 10 || ph < 10) return
      sctx.font = '11px system-ui, sans-serif'
      const yOf = (db: number) => TOP + ((p.ceiling - db) / (p.ceiling - p.floor)) * ph
      // Level grid.
      const dbStep = ph / (p.ceiling - p.floor) >= 3 ? 10 : 20
      sctx.textAlign = 'right'
      sctx.textBaseline = 'middle'
      for (let db = Math.ceil(p.floor / dbStep) * dbStep; db <= p.ceiling; db += dbStep) {
        const y = Math.round(yOf(db)) + 0.5
        sctx.strokeStyle = db === 0 ? col.gridStrong : col.grid
        sctx.beginPath()
        sctx.moveTo(LEFT, y)
        sctx.lineTo(LEFT + pw, y)
        sctx.stroke()
        sctx.fillStyle = col.fg
        sctx.fillText(String(db), LEFT - 6, y)
      }
      sctx.save()
      sctx.fillStyle = col.fg
      sctx.textAlign = 'left'
      sctx.textBaseline = 'top'
      sctx.fillText('dBFS', 4, 2)
      sctx.restore()
      if (!ev) {
        sctx.fillStyle = col.fg
        sctx.textAlign = 'center'
        sctx.fillText(p.t('No signal yet. Press Start.'), LEFT + pw / 2, TOP + ph / 2)
        st.view = null
        return
      }
      const { view } = currentView(ev)
      st.view = view
      // Frequency grid.
      sctx.textAlign = 'center'
      sctx.textBaseline = 'top'
      for (const tk of makeTicks(view, Math.max(3, Math.floor(pw / 70)))) {
        const x = Math.round(LEFT + freqToX(view, tk.value) * pw) + 0.5
        if (x < LEFT || x > LEFT + pw) continue
        sctx.strokeStyle = tk.major ? col.gridStrong : col.grid
        sctx.beginPath()
        sctx.moveTo(x, TOP)
        sctx.lineTo(x, TOP + ph)
        sctx.stroke()
        sctx.fillStyle = col.fg
        sctx.fillText(tk.label, x, TOP + ph + 4)
      }
      // Demodulator channel.
      if (p.marker && ev.iq) {
        const xa = LEFT + freqToX(view, p.marker.freq - p.marker.bw / 2) * pw
        const xb = LEFT + freqToX(view, p.marker.freq + p.marker.bw / 2) * pw
        sctx.fillStyle = col.warn + '33'
        sctx.fillRect(xa, TOP, Math.max(2, xb - xa), ph)
        sctx.strokeStyle = col.warn
        sctx.beginPath()
        const xm = Math.round(LEFT + freqToX(view, p.marker.freq) * pw) + 0.5
        sctx.moveTo(xm, TOP)
        sctx.lineTo(xm, TOP + ph)
        sctx.stroke()
      }
      // Trace.
      const n = Math.max(2, Math.floor(pw))
      st.cols = frameToColumns(ev.frame, view, n, DB_FLOOR, st.cols)
      sctx.save()
      sctx.beginPath()
      sctx.rect(LEFT, TOP, pw, ph)
      sctx.clip()
      if (p.peakHold) {
        st.peakCols = frameToColumns({ freq0: ev.frame.freq0, df: ev.frame.df, db: ev.peak }, view, n, DB_FLOOR, st.peakCols)
        sctx.strokeStyle = col.warn
        sctx.lineWidth = 1
        sctx.beginPath()
        for (let c = 0; c < n; c++) {
          const x = LEFT + ((c + 0.5) / n) * pw
          const y = yOf(st.peakCols[c])
          if (c === 0) sctx.moveTo(x, y)
          else sctx.lineTo(x, y)
        }
        sctx.stroke()
      }
      sctx.beginPath()
      sctx.moveTo(LEFT, TOP + ph)
      for (let c = 0; c < n; c++) sctx.lineTo(LEFT + ((c + 0.5) / n) * pw, yOf(st.cols[c]))
      sctx.lineTo(LEFT + pw, TOP + ph)
      sctx.closePath()
      sctx.fillStyle = col.accent + '33'
      sctx.fill()
      sctx.strokeStyle = col.accent
      sctx.lineWidth = 1.25
      sctx.beginPath()
      for (let c = 0; c < n; c++) {
        const x = LEFT + ((c + 0.5) / n) * pw
        const y = yOf(st.cols[c])
        if (c === 0) sctx.moveTo(x, y)
        else sctx.lineTo(x, y)
      }
      sctx.stroke()
      sctx.restore()
      // Peak markers.
      sctx.textAlign = 'center'
      sctx.textBaseline = 'bottom'
      ev.peaks.forEach((pk: Peak, i: number) => {
        const fx = freqToX(view, pk.freq)
        if (fx < 0 || fx > 1) return
        const x = LEFT + fx * pw
        const y = Math.max(TOP + 10, yOf(pk.db) - 3)
        sctx.fillStyle = col.warn
        sctx.beginPath()
        sctx.moveTo(x, y)
        sctx.lineTo(x - 4, y - 7)
        sctx.lineTo(x + 4, y - 7)
        sctx.closePath()
        sctx.fill()
        sctx.fillStyle = col.fg
        sctx.fillText(String(i + 1), x, y - 7)
      })
      // Cursor.
      const cur = st.cursor
      const ro = readoutRef.current
      if (cur && cur.x >= LEFT && cur.x <= LEFT + pw) {
        const fx = (cur.x - LEFT) / pw
        const f = xToFreq(view, fx)
        const c = Math.min(n - 1, Math.max(0, Math.floor(fx * n)))
        sctx.strokeStyle = col.fg
        sctx.setLineDash([3, 3])
        sctx.beginPath()
        sctx.moveTo(Math.round(cur.x) + 0.5, TOP)
        sctx.lineTo(Math.round(cur.x) + 0.5, TOP + ph)
        if (cur.y >= TOP && cur.y <= TOP + ph) {
          sctx.moveTo(LEFT, Math.round(cur.y) + 0.5)
          sctx.lineTo(LEFT + pw, Math.round(cur.y) + 0.5)
        }
        sctx.stroke()
        sctx.setLineDash([])
        if (ro) {
          const lvl = st.cols[c]
          const note = !ev.iq ? noteName(f) : null
          let text = `${formatFreq(f, ev.iq ? 4 : f < 1000 ? 1 : 2)}  ·  ${lvl > DB_FLOOR ? lvl.toFixed(1) : '–'} dBFS`
          if (p.peakHold && st.peakCols[c] > DB_FLOOR) text += `  ·  ${p.t('peak')} ${st.peakCols[c].toFixed(1)}`
          if (note) text += `  ·  ${note.name} ${note.cents >= 0 ? '+' : ''}${note.cents}¢`
          ro.textContent = text
        }
        if (cursorRef.current) {
          cursorRef.current.style.display = 'block'
          cursorRef.current.style.left = `${Math.round(cur.x)}px`
        }
      } else {
        if (ro) ro.textContent = p.t('Hover or touch the plot to read frequency and level.')
        if (cursorRef.current) cursorRef.current.style.display = 'none'
      }
    }

    function pushRow(ev: FrameEvent): void {
      const p = propsRef.current
      const resized = sizeCanvas(wf)
      const w = wf.width
      const h = wf.height
      const { view } = currentView(ev)
      const key = `${view.fmin}|${view.fmax}|${view.log}|${ev.iq}|${ev.sampleRate}|${ev.centerFreq}|${w}|${h}`
      if (st.lutName !== p.colormap) {
        st.lut = makeLut(p.colormap)
        st.lutName = p.colormap
      }
      if (resized || key !== st.wfKey) {
        st.wfKey = key
        wctx.setTransform(1, 0, 0, 1, 0, 0)
        // Empty history shows the colour map's lowest colour, like a silent band.
        wctx.fillStyle = `rgb(${st.lut[0]}, ${st.lut[1]}, ${st.lut[2]})`
        wctx.fillRect(0, 0, w, h)
      }
      const now = performance.now()
      if (now - st.lastRow < 1000 / p.wfRate) return
      st.lastRow = now
      if (st.row.length !== w * 4) {
        st.row = new Uint8ClampedArray(w * 4)
        st.rowImg = new ImageData(st.row, w, 1)
      }
      const cols = frameToColumns(ev.frame, view, w, DB_FLOOR)
      colorize(cols, p.floor, p.ceiling, st.lut, st.row)
      wctx.setTransform(1, 0, 0, 1, 0, 0)
      wctx.drawImage(wf, 0, 0, w, h - 1, 0, 1, w, h - 1)
      wctx.putImageData(st.rowImg!, 0, 0)
    }

    const unsub = propsRef.current.engine.subscribe((ev) => {
      pushRow(ev)
      drawSpectrum()
    })
    redrawRef.current = () => {
      drawSpectrum()
    }

    const ro = new ResizeObserver(() => drawSpectrum())
    ro.observe(spec)
    ro.observe(wf)

    const localX = (e: PointerEvent | MouseEvent) => {
      const r = spec.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }
    }
    const limits = () => {
      const ev = propsRef.current.engine.last
      return ev ? baseView(ev, propsRef.current.logAxis) : null
    }
    const minSpan = () => {
      const ev = propsRef.current.engine.last
      return ev ? ev.frame.df * 8 : 1
    }

    const onMove = (e: PointerEvent) => {
      const { x, y, w } = localX(e)
      st.cursor = { x, y }
      if (st.drag && st.view) {
        const dx = x - st.drag.x
        if (Math.abs(dx) > 4) st.drag.moved = true
        const base = limits()
        if (st.drag.moved && base) {
          const next = panView(st.drag.view, -dx / (w - LEFT - RIGHT), base.fmin, base.fmax)
          st.zoom = next.fmin <= base.fmin && next.fmax >= base.fmax ? null : next
        }
      }
      drawSpectrum()
      if (st.drag?.moved) {
        // History no longer lines up with the new window.
        st.wfKey = ''
      }
    }
    const onDown = (e: PointerEvent) => {
      const { x } = localX(e)
      if (e.target instanceof Element && e.target.closest('.zoombar')) return
      wrap.setPointerCapture(e.pointerId)
      st.drag = { x, view: st.view ?? { fmin: 0, fmax: 1, log: false }, moved: false }
      onMove(e)
    }
    const onUp = (e: PointerEvent) => {
      const d = st.drag
      st.drag = null
      if (d && !d.moved && st.view) {
        const { x, w } = localX(e)
        const fx = (x - LEFT) / (w - LEFT - RIGHT)
        if (fx >= 0 && fx <= 1) propsRef.current.onPick(xToFreq(st.view, fx))
      }
      if (e.pointerType !== 'mouse') {
        st.cursor = null
        drawSpectrum()
      }
    }
    const onLeave = () => {
      if (!st.drag) {
        st.cursor = null
        drawSpectrum()
      }
    }
    const onWheel = (e: WheelEvent) => {
      const base = limits()
      if (!base || !st.view) return
      e.preventDefault()
      const { x, w } = localX(e)
      const anchor = Math.min(1, Math.max(0, (x - LEFT) / (w - LEFT - RIGHT)))
      const next = zoomView(st.view, anchor, e.deltaY < 0 ? 0.8 : 1.25, base.fmin, base.fmax, minSpan())
      st.zoom = next.fmin <= base.fmin && next.fmax >= base.fmax ? null : next
      st.wfKey = ''
      drawSpectrum()
    }
    const reset = () => {
      st.zoom = null
      st.wfKey = ''
      drawSpectrum()
    }
    zoomActions.current = {
      zoom: (f: number) => {
        const base = limits()
        if (!base || !st.view) return
        const next = zoomView(st.view, 0.5, f, base.fmin, base.fmax, minSpan())
        st.zoom = next.fmin <= base.fmin && next.fmax >= base.fmax ? null : next
        st.wfKey = ''
        drawSpectrum()
      },
      reset,
    }
    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerdown', onDown)
    wrap.addEventListener('pointerup', onUp)
    wrap.addEventListener('pointercancel', onUp)
    wrap.addEventListener('pointerleave', onLeave)
    wrap.addEventListener('wheel', onWheel, { passive: false })
    wrap.addEventListener('dblclick', reset)
    drawSpectrum()
    return () => {
      unsub()
      ro.disconnect()
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerdown', onDown)
      wrap.removeEventListener('pointerup', onUp)
      wrap.removeEventListener('pointercancel', onUp)
      wrap.removeEventListener('pointerleave', onLeave)
      wrap.removeEventListener('wheel', onWheel)
      wrap.removeEventListener('dblclick', reset)
    }
    // The effect sets up long-lived canvas handlers once; props are read through propsRef.
  }, [props.engine])

  // Settings changes (levels, axis, theme-affecting props) redraw the trace immediately, even when paused.
  useEffect(() => {
    redrawRef.current()
  }, [props.logAxis, props.floor, props.ceiling, props.peakHold, props.marker?.freq, props.marker?.bw, props.t])

  const { t } = props
  return (
    <div className="chart" ref={wrapRef}>
      <div className="readout" ref={readoutRef} aria-live="off" />
      <canvas className="spec" ref={specRef} role="img" aria-label={t('Spectrum plot')} />
      <div className="wfwrap">
        <canvas className="wf" ref={wfRef} role="img" aria-label={t('Waterfall plot')} />
        <div className="wfcursor" ref={cursorRef} />
      </div>
      <div className="zoombar">
        <button className="small" onClick={() => zoomActions.current.zoom(0.5)} aria-label={t('Zoom in')} title={t('Zoom in')}>+</button>
        <button className="small" onClick={() => zoomActions.current.zoom(2)} aria-label={t('Zoom out')} title={t('Zoom out')}>−</button>
        <button className="small" onClick={() => zoomActions.current.reset()} title={t('Reset zoom')}>{t('Reset zoom')}</button>
      </div>
    </div>
  )
}
