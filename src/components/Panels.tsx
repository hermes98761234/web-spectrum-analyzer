import { useMemo, useRef } from 'react'
import { COLORMAPS } from '../lib/colormaps'
import { formatFreq } from '../lib/axis'
import { enbw, makeWindow, WINDOWS } from '../lib/windows'
import { webUsbProblem } from '../lib/rtlsdr/rtlsdr'
import type { FrameEvent } from '../engine'
import { N, type T } from '../i18n'
import { AVERAGES, FFT_SIZES, GEN_IQ, GEN_RATES, GEN_REAL, SDR_GEN_RATES, SDR_RATES, type Settings, type SourceKind } from '../settings'
import NumField from './NumField'

type Patch = (p: Partial<Settings>) => void

const WINDOW_LABEL: Record<string, string> = {
  hann: N('Hann'),
  hamming: N('Hamming'),
  'blackman-harris': N('Blackman-Harris'),
  'flat-top': N('Flat-top'),
  rectangular: N('Rectangular'),
}

const COLORMAP_LABEL: Record<string, string> = {
  viridis: N('Viridis'),
  inferno: N('Inferno'),
  turbo: N('Turbo'),
  sdr: N('Classic SDR'),
  gray: N('Grayscale'),
}

const SOURCES: { id: SourceKind; label: string }[] = [
  { id: 'generator', label: N('Generator') },
  { id: 'mic', label: N('Microphone') },
  { id: 'file', label: N('Audio file') },
  { id: 'sdr', label: 'RTL-SDR' },
]

const PRESETS: { label: string; freq: number }[] = [
  { label: N('FM broadcast'), freq: 98.0e6 },
  { label: N('Airband'), freq: 124.0e6 },
  { label: N('NOAA weather'), freq: 162.55e6 },
  { label: N('ISM 433'), freq: 433.92e6 },
  { label: N('ADS-B'), freq: 1090e6 },
]

interface SourcePanelProps {
  s: Settings
  patch: Patch
  t: T
  running: boolean
  busy: boolean
  fileName: string
  fileMount: (el: HTMLDivElement | null) => void
  onStartStop: () => void
  onPickFile: (f: File) => void
  onChooseDevice: () => void
  deviceName: string
  tunerName: string
  onFlush: () => void
}

export function SourcePanel(p: SourcePanelProps) {
  const { s, patch, t } = p
  const usbProblem = webUsbProblem()
  const setGen = (g: Partial<Settings['gen']>) => patch({ gen: { ...s.gen, ...g } })
  const setSdr = (g: Partial<Settings['sdr']>) => patch({ sdr: { ...s.sdr, ...g } })
  const unit = s.gen.iq ? 1000 : 1
  const unitLabel = s.gen.iq ? 'kHz' : 'Hz'
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <section className="section">
      <h3>{t('Source')}</h3>
      <div className="seg" role="tablist" aria-label={t('Source')}>
        {SOURCES.map((x) => (
          <button key={x.id} role="tab" aria-selected={s.source === x.id} className={s.source === x.id ? 'on' : ''} onClick={() => patch({ source: x.id })}>
            {x.id === 'sdr' ? x.label : t(x.label)}
          </button>
        ))}
      </div>

      {s.source === 'generator' && (
        <div className="stack">
          <p className="hint">{t('Built-in test signals. Needs no permissions or hardware.')}</p>
          <div className="grid2">
            <label className="field">
              <span>{t('Signal type')}</span>
              <select value={s.gen.iq ? 'iq' : 'real'} onChange={(e) => patch({ gen: e.target.value === 'iq' ? GEN_IQ : GEN_REAL })}>
                <option value="real">{t('Audio (real)')}</option>
                <option value="iq">{t('Simulated SDR (IQ)')}</option>
              </select>
            </label>
            <label className="field">
              <span>{t('Sample rate')}</span>
              <select value={s.gen.sampleRate} onChange={(e) => setGen({ sampleRate: +e.target.value })}>
                {(s.gen.iq ? SDR_GEN_RATES : GEN_RATES).map((r) => (
                  <option key={r} value={r}>
                    {formatFreq(r, r >= 1e6 ? 3 : 0)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {s.gen.iq && <NumField label={t('Centre frequency')} unit="MHz" scale={1e6} value={s.gen.centerFreq} min={0} max={2e9} onChange={(v) => setGen({ centerFreq: v })} />}
          {s.gen.tones.map((tone, i) => (
            <div className="genrow" key={i}>
              <label className="chk">
                <input
                  type="checkbox"
                  checked={tone.enabled}
                  onChange={(e) => setGen({ tones: s.gen.tones.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })}
                />
                {t('Tone {0}', i + 1)}
              </label>
              <NumField
                value={tone.freq}
                scale={unit}
                unit={unitLabel}
                disabled={!tone.enabled}
                onChange={(v) => setGen({ tones: s.gen.tones.map((x, j) => (j === i ? { ...x, freq: v } : x)) })}
              />
              <NumField
                value={tone.level}
                unit="dB"
                min={-140}
                max={0}
                disabled={!tone.enabled}
                onChange={(v) => setGen({ tones: s.gen.tones.map((x, j) => (j === i ? { ...x, level: v } : x)) })}
              />
            </div>
          ))}
          <div className="genrow">
            <label className="chk">
              <input type="checkbox" checked={s.gen.chirp.enabled} onChange={(e) => setGen({ chirp: { ...s.gen.chirp, enabled: e.target.checked } })} />
              {t('Chirp')}
            </label>
            <NumField label={t('from')} scale={unit} unit={unitLabel} value={s.gen.chirp.f0} disabled={!s.gen.chirp.enabled} onChange={(v) => setGen({ chirp: { ...s.gen.chirp, f0: v } })} />
            <NumField label={t('to')} scale={unit} unit={unitLabel} value={s.gen.chirp.f1} disabled={!s.gen.chirp.enabled} onChange={(v) => setGen({ chirp: { ...s.gen.chirp, f1: v } })} />
            <NumField label={t('period')} unit="s" min={0.1} max={60} value={s.gen.chirp.period} disabled={!s.gen.chirp.enabled} onChange={(v) => setGen({ chirp: { ...s.gen.chirp, period: v } })} />
            <NumField label={t('level')} unit="dB" min={-140} max={0} value={s.gen.chirp.level} disabled={!s.gen.chirp.enabled} onChange={(v) => setGen({ chirp: { ...s.gen.chirp, level: v } })} />
          </div>
          <div className="genrow">
            <label className="chk">
              <input type="checkbox" checked={s.gen.noise.enabled} onChange={(e) => setGen({ noise: { ...s.gen.noise, enabled: e.target.checked } })} />
              {t('White noise')}
            </label>
            <NumField label={t('RMS level')} unit="dB" min={-140} max={0} value={s.gen.noise.level} disabled={!s.gen.noise.enabled} onChange={(v) => setGen({ noise: { ...s.gen.noise, level: v } })} />
          </div>
        </div>
      )}

      {s.source === 'mic' && (
        <p className="hint">
          {t('Live input from your microphone or line-in. Echo cancellation, noise suppression and auto-gain are switched off so the spectrum is honest. Audio never leaves your browser.')}
        </p>
      )}

      {s.source === 'file' && (
        <div className="stack">
          <p className="hint">{t('Plays a local audio file (looped) and analyses what you hear. The file is not uploaded.')}</p>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,video/mp4,video/webm"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) p.onPickFile(f)
              e.target.value = ''
            }}
          />
          <div className="row">
            <button onClick={() => fileInput.current?.click()}>{t('Choose audio file…')}</button>
            <span className="hint fname">{p.fileName}</span>
          </div>
          <div ref={p.fileMount} className="audiomount" />
        </div>
      )}

      {s.source === 'sdr' && (
        <div className="stack">
          {usbProblem && (
            <div className="notice warn" role="alert">
              <strong>{t('WebUSB is not available.')}</strong>{' '}
              {usbProblem === 'insecure'
                ? t('WebUSB only works on secure pages (HTTPS or localhost).')
                : t('This browser does not support WebUSB (Firefox and Safari do not). Use Chrome, Edge, Brave or another Chromium browser on desktop or Android to connect an RTL-SDR dongle. All other sources work here.')}
            </div>
          )}
          {!usbProblem && !p.running && (
            <p className="hint">{t('Plug in an RTL-SDR (RTL2832U with R820T/R820T2/R828D tuner), then press Start and pick it in the browser dialog.')}</p>
          )}
          {p.running && (
            <p className="hint">
              {p.deviceName} · {t('tuner')} {p.tunerName}
            </p>
          )}
          <div className="grid2">
            <NumField label={t('Centre frequency')} unit="MHz" scale={1e6} decimals={4} step={0.1} min={24e6} max={1766e6} value={s.sdr.freq} onChange={(v) => setSdr({ freq: v })} />
            <label className="field">
              <span>{t('Sample rate')}</span>
              <select value={s.sdr.rate} onChange={(e) => setSdr({ rate: +e.target.value })}>
                {SDR_RATES.map((r) => (
                  <option key={r} value={r}>
                    {formatFreq(r, 3)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row wrap">
            {PRESETS.map((x) => (
              <button key={x.label} className="small" onClick={() => setSdr({ freq: x.freq })}>
                {t(x.label)}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="small" onClick={() => setSdr({ freq: Math.max(24e6, s.sdr.freq - s.sdr.rate / 2) })} aria-label={t('Tune down by half the span')}>◀ ½</button>
            <button className="small" onClick={() => setSdr({ freq: Math.min(1766e6, s.sdr.freq + s.sdr.rate / 2) })} aria-label={t('Tune up by half the span')}>½ ▶</button>
            <span className="hint">{t('Click the spectrum: picks the channel when listening, otherwise recentres.')}</span>
          </div>
          <div className="field">
            <span>
              {t('Tuner gain')}: {s.sdr.gain === null ? t('auto') : `${s.sdr.gain.toFixed(0)} dB`}
            </span>
            <div className="row">
              <label className="chk">
                <input type="checkbox" checked={s.sdr.gain === null} onChange={(e) => setSdr({ gain: e.target.checked ? null : 30 })} />
                {t('Auto')}
              </label>
              <input type="range" min={0} max={50} step={1} disabled={s.sdr.gain === null} value={s.sdr.gain ?? 30} onChange={(e) => setSdr({ gain: +e.target.value })} aria-label={t('Tuner gain')} />
            </div>
          </div>
          <div className="grid2">
            <NumField label={t('Frequency correction')} unit="ppm" min={-200} max={200} value={s.sdr.ppm} onChange={(v) => setSdr({ ppm: v })} />
            <label className="chk pad">
              <input type="checkbox" checked={s.sdr.dcRemove} onChange={(e) => setSdr({ dcRemove: e.target.checked })} />
              {t('Remove DC spike')}
            </label>
          </div>
          <div className="grid2">
            <label className="field">
              <span>{t('Listen (demodulate)')}</span>
              <select value={s.sdr.demod} onChange={(e) => setSdr({ demod: e.target.value as Settings['sdr']['demod'] })}>
                <option value="off">{t('Off')}</option>
                <option value="wbfm">{t('WBFM (broadcast FM)')}</option>
                <option value="am">AM</option>
              </select>
            </label>
            <label className="field">
              <span>{t('Volume')}</span>
              <input type="range" min={0} max={1} step={0.05} value={s.sdr.volume} onChange={(e) => setSdr({ volume: +e.target.value })} aria-label={t('Volume')} />
            </label>
          </div>
          {s.sdr.demod !== 'off' && (
            <div className="row">
              <span className="hint">
                {t('Channel')}: {formatFreq(s.sdr.freq + s.sdr.offset, 4)}
              </span>
              <button className="small" onClick={() => setSdr({ offset: 0 })} disabled={s.sdr.offset === 0}>
                {t('Centre')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="row startrow">
        <button className="primary" onClick={p.onStartStop} disabled={p.busy || (s.source === 'sdr' && !!usbProblem) || (s.source === 'file' && !p.running && !p.fileName)}>
          {p.busy ? t('Starting…') : p.running ? t('Stop') : t('Start')}
        </button>
        {s.source === 'sdr' && !usbProblem && (
          <button onClick={p.onChooseDevice} disabled={p.busy}>
            {t('Choose device…')}
          </button>
        )}
      </div>
    </section>
  )
}

export function AnalyzerPanel({ s, patch, t, paused, onPause, onResetPeak, ev }: { s: Settings; patch: Patch; t: T; paused: boolean; onPause: () => void; onResetPeak: () => void; ev: FrameEvent | null }) {
  const fs = ev?.sampleRate ?? (s.source === 'generator' ? s.gen.sampleRate : 48000)
  const df = fs / s.fftSize
  const nb = useMemo(() => enbw(makeWindow(s.window, s.fftSize)), [s.window, s.fftSize])
  return (
    <section className="section">
      <h3>{t('Analyzer')}</h3>
      <div className="grid2">
        <label className="field">
          <span>{t('FFT size')}</span>
          <select value={s.fftSize} onChange={(e) => patch({ fftSize: +e.target.value })}>
            {FFT_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('Window')}</span>
          <select value={s.window} onChange={(e) => patch({ window: e.target.value as Settings['window'] })}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {t(WINDOW_LABEL[w])}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('Averaging')}</span>
          <select value={s.averages} onChange={(e) => patch({ averages: +e.target.value })}>
            {AVERAGES.map((n) => (
              <option key={n} value={n}>
                {n === 1 ? t('Off') : `${n}×`}
              </option>
            ))}
          </select>
        </label>
        <label className="chk pad">
          <input type="checkbox" checked={s.peakHold} onChange={(e) => patch({ peakHold: e.target.checked })} />
          {t('Peak hold')}
        </label>
      </div>
      <p className="hint">
        {t('Resolution {0} per bin, noise bandwidth {1}.', formatFreq(df, df < 1000 ? 2 : 3), formatFreq(df * nb, df * nb < 1000 ? 2 : 3))}
      </p>
      <div className="row wrap">
        <button onClick={onPause} aria-pressed={paused}>
          {paused ? t('Resume') : t('Freeze')}
        </button>
        <button onClick={onResetPeak}>{t('Reset peak hold')}</button>
      </div>
    </section>
  )
}

export function DisplayPanel({ s, patch, t, iq, onAuto }: { s: Settings; patch: Patch; t: T; iq: boolean; onAuto: () => void }) {
  return (
    <section className="section">
      <h3>{t('Display')}</h3>
      <div className="grid2">
        <label className="field">
          <span>{t('Frequency axis')}</span>
          <select value={s.logAxis && !iq ? 'log' : 'lin'} disabled={iq} onChange={(e) => patch({ logAxis: e.target.value === 'log' })}>
            <option value="lin">{t('Linear')}</option>
            <option value="log">{t('Logarithmic')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('Colour map')}</span>
          <select value={s.colormap} onChange={(e) => patch({ colormap: e.target.value as Settings['colormap'] })}>
            {COLORMAPS.map((c) => (
              <option key={c} value={c}>
                {t(COLORMAP_LABEL[c])}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid2">
        <NumField label={t('Ceiling')} unit="dB" min={-100} max={20} value={s.ceiling} onChange={(v) => patch({ ceiling: Math.max(v, s.floor + 10) })} />
        <NumField label={t('Floor')} unit="dB" min={-200} max={-10} value={s.floor} onChange={(v) => patch({ floor: Math.min(v, s.ceiling - 10) })} />
      </div>
      <div className="grid2">
        <label className="field">
          <span>{t('Waterfall speed')}: {s.wfRate} {t('rows/s')}</span>
          <input type="range" min={1} max={60} step={1} value={s.wfRate} onChange={(e) => patch({ wfRate: +e.target.value })} aria-label={t('Waterfall speed')} />
        </label>
        <label className="field">
          <span>{t('Peak markers')}: {s.peakCount}</span>
          <input type="range" min={0} max={10} step={1} value={s.peakCount} onChange={(e) => patch({ peakCount: +e.target.value })} aria-label={t('Peak markers')} />
        </label>
      </div>
      <div className="row">
        <button onClick={onAuto}>{t('Auto levels')}</button>
      </div>
    </section>
  )
}

export function PeakList({ ev, t, onTune }: { ev: FrameEvent | null; t: T; onTune?: (f: number) => void }) {
  const sorted = ev?.peaks ?? []
  return (
    <section className="box peaks">
      <h3>{t('Peaks')}</h3>
      {sorted.length === 0 ? (
        <p className="hint">{t('No peaks above the noise floor.')}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('Frequency')}</th>
              <th>{t('Level')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((pk, i) => (
              <tr key={i} onClick={() => onTune?.(pk.freq)} className={onTune ? 'click' : ''}>
                <td>{i + 1}</td>
                <td>{formatFreq(pk.freq, ev?.iq ? 4 : pk.freq < 1000 ? 1 : 2)}</td>
                <td>{pk.db.toFixed(1)} dBFS</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
