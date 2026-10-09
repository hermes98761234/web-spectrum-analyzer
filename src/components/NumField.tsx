import { useEffect, useState } from 'react'

interface Props {
  label?: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  /** Value shown = value / scale (e.g. 1e6 to edit Hz as MHz). */
  scale?: number
  unit?: string
  disabled?: boolean
  decimals?: number
}

/** Number input that lets you type freely and commits a clamped value when it parses. */
export default function NumField({ label, value, onChange, min = -Infinity, max = Infinity, step, scale = 1, unit, disabled, decimals }: Props) {
  const fmt = (v: number) => String(decimals !== undefined ? Number((v / scale).toFixed(decimals)) : Number((v / scale).toPrecision(10)))
  const [draft, setDraft] = useState(fmt(value))
  useEffect(() => setDraft(fmt(value)), [value, scale])
  const commit = (s: string) => {
    const v = Number(s) * scale
    if (s.trim() !== '' && Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
  }
  const bad = draft.trim() === '' || !Number.isFinite(Number(draft)) || Number(draft) * scale < min || Number(draft) * scale > max
  return (
    <label className="field">
      {label && <span>{label}</span>}
      <span className="inp">
        <input
          type="number"
          inputMode="decimal"
          value={draft}
          step={step}
          disabled={disabled}
          className={bad ? 'bad' : ''}
          onChange={(e) => {
            setDraft(e.target.value)
            commit(e.target.value)
          }}
          onBlur={() => setDraft(fmt(value))}
        />
        {unit && <em>{unit}</em>}
      </span>
    </label>
  )
}
