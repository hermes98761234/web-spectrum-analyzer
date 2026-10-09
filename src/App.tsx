import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Engine } from './engine'
import { tr, type T } from './i18n'
import { autoLevels, type Peak } from './lib/spectrum'
import { RtlSdr } from './lib/rtlsdr/rtlsdr'
import { formatFreq } from './lib/axis'
import { loadSettings, saveSettings, type Settings } from './settings'
import { GeneratorSource } from './sources/generator'
import { FileSource, MicSource } from './sources/audio'
import { SdrSource } from './sources/sdr'
import type { Source } from './sources/types'
import { useFrame, useStatus } from './useFrame'
import SpectrumView from './components/SpectrumView'
import { AnalyzerPanel, DisplayPanel, PeakList, SourcePanel } from './components/Panels'

export default function App() {
  const [s, setS] = useState<Settings>(loadSettings)
  const [engine] = useState(() => new Engine())
  const { status, error } = useStatus(engine)
  const ev = useFrame(engine, 250)
  const [busy, setBusy] = useState(false)
  const [paused, setPaused] = useState(false)
  const [fileName, setFileName] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [tunerName, setTunerName] = useState('')
  const src = useRef<Source | null>(null)
  const file = useRef<File | null>(null)
  const device = useRef<RtlSdr | null>(null)
  const fileMountEl = useRef<HTMLDivElement | null>(null)
  const sRef = useRef(s)
  useEffect(() => {
    sRef.current = s
  })
  const t: T = useMemo(() => (str, ...a) => tr(s.lang, str, ...a), [s.lang])
  const running = status === 'running'

  const patch = useCallback(
    (p: Partial<Settings>) => {
      if (p.source && p.source !== sRef.current.source && engine.status !== 'idle') void engine.stop()
      setS((prev) => ({ ...prev, ...p }))
    },
    [engine],
  )

  useEffect(() => saveSettings(s), [s])
  useEffect(() => {
    const root = document.documentElement
    if (s.theme === 'auto') delete root.dataset.theme
    else root.dataset.theme = s.theme
    root.lang = s.lang
  }, [s.theme, s.lang])

  useEffect(() => {
    engine.configure({ size: s.fftSize, window: s.window, averages: s.averages, peakCount: s.peakCount, dcRemove: s.sdr.dcRemove })
  }, [engine, s.fftSize, s.window, s.averages, s.peakCount, s.sdr.dcRemove])
  useEffect(() => {
    engine.setDemod({ mode: s.source === 'sdr' ? s.sdr.demod : 'off', offset: s.sdr.offset, volume: s.sdr.volume })
  }, [engine, s.source, s.sdr.demod, s.sdr.offset, s.sdr.volume])
  useEffect(() => {
    if (s.sdr.demod !== 'off' && running && s.source === 'sdr') void engine.enableAudio().catch(() => undefined)
  }, [engine, s.sdr.demod, running, s.source])
  useEffect(() => {
    if (s.peakHold) engine.resetPeak()
  }, [engine, s.peakHold])

  // Live parameter changes for the running source.
  const gen = s.gen
  useEffect(() => {
    const cur = src.current
    if (!(cur instanceof GeneratorSource) || engine.status !== 'running') return
    if (cur.sampleRate !== gen.sampleRate || cur.iq !== gen.iq || (gen.iq && cur.centerFreq !== gen.centerFreq)) {
      const next = new GeneratorSource(gen)
      next.setNeed(sRef.current.fftSize)
      src.current = next
      void engine.start(next)
    } else cur.update(gen)
  }, [engine, gen])
  useEffect(() => {
    if (src.current instanceof GeneratorSource) src.current.setNeed(s.fftSize)
  }, [s.fftSize])
  useEffect(() => {
    const cur = src.current
    if (cur instanceof SdrSource && engine.status === 'running') cur.configure({ freq: s.sdr.freq, rate: s.sdr.rate, gain: s.sdr.gain })
  }, [engine, s.sdr.freq, s.sdr.rate, s.sdr.gain])

  const start = useCallback(async () => {
    const cfg = sRef.current
    setBusy(true)
    try {
      let next: Source
      if (cfg.source === 'generator') {
        const g = new GeneratorSource(cfg.gen)
        g.setNeed(cfg.fftSize)
        next = g
      }
      else if (cfg.source === 'mic') next = new MicSource()
      else if (cfg.source === 'file') {
        if (!file.current) return
        const fs = new FileSource(file.current)
        fileMountEl.current?.replaceChildren(fs.element)
        next = fs
      } else {
        if (!device.current) {
          const known = await RtlSdr.getDevices().catch(() => [])
          device.current = known[0] ?? (await RtlSdr.requestDevice())
        }
        setDeviceName(device.current.name)
        const sdr = new SdrSource(device.current, { freq: cfg.sdr.freq, rate: cfg.sdr.rate, gain: cfg.sdr.gain, ppm: cfg.sdr.ppm })
        sdr.onRetune = () => engine.flush()
        next = sdr
      }
      src.current = next
      engine.setPaused(false)
      setPaused(false)
      await engine.start(next)
      if (next instanceof SdrSource) setTunerName(next.tuner)
    } catch (e) {
      // The device picker was dismissed or access was denied: nothing to start.
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) console.error(e)
    } finally {
      setBusy(false)
    }
  }, [engine])

  // The generator is the one source that needs no permission, so it starts right away.
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    if (sRef.current.source === 'generator') void start()
  }, [start])

  const onStartStop = () => {
    if (running) void engine.stop()
    else void start()
  }

  const chooseDevice = async () => {
    try {
      device.current = await RtlSdr.requestDevice()
      setDeviceName(device.current.name)
      if (engine.status !== 'idle') await engine.stop()
      void start()
    } catch {
      // Dismissed.
    }
  }

  const pickFile = (f: File) => {
    file.current = f
    setFileName(f.name)
    patch({ source: 'file' })
    void engine.stop().then(() => start())
  }

  const onPick = (freq: number) => {
    if (s.source !== 'sdr') return
    if (s.sdr.demod === 'off') patch({ sdr: { ...s.sdr, freq: Math.round(freq / 1000) * 1000, offset: 0 } })
    else {
      const lim = s.sdr.rate * 0.48
      patch({ sdr: { ...s.sdr, offset: Math.round(Math.max(-lim, Math.min(lim, freq - s.sdr.freq)) / 1000) * 1000 } })
    }
  }

  const onTunePeak = (f: number) => {
    if (s.source === 'sdr') onPick(f)
  }

  const onAuto = () => {
    if (!engine.last) return
    patch(autoLevels(engine.last.frame.db))
  }

  const marker = s.source === 'sdr' && s.sdr.demod !== 'off' ? { freq: s.sdr.freq + s.sdr.offset, bw: s.sdr.demod === 'wbfm' ? 200e3 : 10e3 } : null
  const iq = ev?.iq ?? (s.source === 'sdr' || (s.source === 'generator' && s.gen.iq))
  const peakSummary: Peak | undefined = ev?.peaks[0]

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">
          <svg className="logo" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="currentColor" />
            <path d="M8 46h10l4-18 5 26 6-40 6 30 4-10h13" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('Web Spectrum Analyzer')}
        </span>
        <span className="hint tagline">{t('FFT spectrum and waterfall for audio and RTL-SDR, in your browser.')}</span>
        <span className="spacer" />
        <label className="inline">
          <span className="sr">{t('Language')}</span>
          <select value={s.lang} onChange={(e) => patch({ lang: e.target.value as Settings['lang'] })} aria-label={t('Language')}>
            <option value="en">English</option>
            <option value="uk">Українська</option>
          </select>
        </label>
        <label className="inline">
          <span className="sr">{t('Theme')}</span>
          <select value={s.theme} onChange={(e) => patch({ theme: e.target.value as Settings['theme'] })} aria-label={t('Theme')}>
            <option value="auto">{t('System')}</option>
            <option value="light">{t('Light')}</option>
            <option value="dark">{t('Dark')}</option>
          </select>
        </label>
      </header>
      <div className="body">
        <main className="main">
          {status === 'error' && (
            <div className="notice err" role="alert">
              <strong>{t('Could not start')}:</strong> {error}
              {s.source === 'sdr' && <p className="hint">{t('Linux: unload the kernel TV driver (sudo rmmod dvb_usb_rtl28xxu rtl2832) and allow USB access with a udev rule. Windows: install the WinUSB driver for the dongle with Zadig. Close other SDR programs, then replug the dongle.')}</p>}
            </div>
          )}
          <div className="box chartbox">
            <SpectrumView
              engine={engine}
              logAxis={s.logAxis}
              floor={s.floor}
              ceiling={s.ceiling}
              colormap={s.colormap}
              wfRate={s.wfRate}
              peakHold={s.peakHold}
              marker={marker}
              onPick={onPick}
              t={t}
            />
            <div className="statusline">
              <span className={`dot ${status}`} aria-hidden="true" />
              <span>
                {status === 'running' ? (paused ? t('Frozen') : t('Live')) : status === 'starting' ? t('Starting…') : t('Stopped')}
              </span>
              {ev && running && (
                <>
                  <span>· {t('sample rate')} {formatFreq(ev.sampleRate, 3)}</span>
                  <span>· {ev.iq ? t('IQ (complex)') : t('real')}</span>
                  {ev.iq && <span>· {t('centre')} {formatFreq(ev.centerFreq, 4)}</span>}
                  {peakSummary && <span>· {t('strongest')} {formatFreq(peakSummary.freq, ev.iq ? 4 : 1)} {peakSummary.db.toFixed(1)} dBFS</span>}
                </>
              )}
              <span className="spacer" />
              <span className="hint">{t('Scroll or use +/− to zoom, drag to pan, double-click to reset.')}</span>
            </div>
          </div>
          <PeakList ev={ev} t={t} onTune={s.source === 'sdr' ? onTunePeak : undefined} />
        </main>
        <aside className="side">
          <div className="panel">
            <SourcePanel
              s={s}
              patch={patch}
              t={t}
              running={running}
              busy={busy || status === 'starting'}
              fileName={fileName}
              fileMount={(el) => {
                fileMountEl.current = el
              }}
              onStartStop={onStartStop}
              onPickFile={pickFile}
              onChooseDevice={() => void chooseDevice()}
              deviceName={deviceName}
              tunerName={tunerName}
              onFlush={() => engine.flush()}
            />
            <AnalyzerPanel
              s={s}
              patch={patch}
              t={t}
              ev={ev}
              paused={paused}
              onPause={() => {
                const next = !paused
                engine.setPaused(next)
                setPaused(next)
              }}
              onResetPeak={() => engine.resetPeak()}
            />
            <DisplayPanel s={s} patch={patch} t={t} iq={iq} onAuto={onAuto} />
          </div>
        </aside>
      </div>
      <footer className="foot hint">
        {t('Everything runs locally in your browser: no audio or radio data is uploaded.')}{' '}
        <a href="https://github.com/hermes98761234/web-spectrum-analyzer">{t('Source on GitHub')}</a>
        {' · '}
        <a href="https://github.com/sandeepmistry/rtlsdrjs">rtlsdrjs (Apache-2.0)</a>
      </footer>
    </div>
  )
}
