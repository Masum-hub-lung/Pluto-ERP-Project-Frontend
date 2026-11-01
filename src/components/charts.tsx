import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Kpi } from '../api/contract.gen'
import { compareDecimal } from '../lib/decimal'
import { formatTaka } from '../lib/format'
import { ds } from '../ds'

/**
 * Dashboard charts (A1–A8; backlog P14.2-FE-01): small hand-rolled SVG and CSS bars in the design's chart style — no
 * chart library. Every height, width and point comes from the API's `pct` fields (0–100); amounts are only shown,
 * formatted, never scaled here (rule 4). Each chart has a text alternative for screen readers.
 */
const pct = (v: string | number | null | undefined) => Math.max(0, Math.min(100, Number(v ?? 0))) // percentages from the API, not money

/** KPI tile (Kpi): label, amount, change against the previous period, sparkline, foot; opens its page. */
export function KpiTile({ kpi, invert = false }: { kpi: Kpi; invert?: boolean }) {
  const { Icon } = ds()
  const navigate = useNavigate()
  const up = kpi.delta_pct != null ? compareDecimal(kpi.delta_pct, '0') >= 0 : null
  const good = up === null ? null : invert ? !up : up
  const open = kpi.link ? () => navigate(kpi.link!) : undefined
  return (
    <div className="lf-c3 lf-kpi" data-testid={`kpi-${kpi.key}`} role={open ? 'link' : undefined} tabIndex={open ? 0 : undefined} onClick={open}
      onKeyDown={(e) => { if (open && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open() } }}
      style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)', padding: '14px 18px',
        display: 'flex', flexDirection: 'column', gap: 4, cursor: open ? 'pointer' : undefined, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={{ font: '600 13px/18px var(--font-sans)', color: 'var(--ink-muted)' }}>{kpi.label}</span>
        {(kpi.trend_pct?.length ?? 0) > 1 && <Sparkline points={kpi.trend_pct!} tone={good === false ? 'negative' : 'accent'} />}
      </div>
      <span className="lf-num" data-testid={`kpi-${kpi.key}-value`} style={{ font: '500 26px/32px var(--font-serif)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: compareDecimal(kpi.value, '0') < 0 ? 'var(--negative)' : undefined }}>{formatTaka(kpi.value, { symbol: true })}</span>
      <span style={{ fontSize: 13, color: 'var(--ink-muted)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {kpi.delta_pct != null && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontWeight: 600, color: good ? 'var(--positive)' : 'var(--negative)' }}>
            <Icon name={up ? 'arrow-up-right' : 'arrow-down-right'} size={14} />{up ? '+' : ''}{kpi.delta_pct} %
          </span>
        )}
        {kpi.delta_pct != null && <span>vs last period</span>}
        {kpi.foot && <span>{kpi.delta_pct != null ? '· ' : ''}{kpi.foot}</span>}
      </span>
    </div>
  )
}

/** Small line from 0–100 positions (oldest first). */
export function Sparkline({ points, width = 72, height = 22, tone = 'accent' }: { points: string[]; width?: number; height?: number; tone?: 'accent' | 'negative' }) {
  const n = points.length
  const xy = points.map((p, i) => [1 + (i / Math.max(1, n - 1)) * (width - 2), height - 2 - (pct(p) / 100) * (height - 4)])
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const colour = tone === 'negative' ? 'var(--negative)' : 'var(--accent, var(--ink))'
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ flex: 'none' }}>
      <path d={`${d} L${xy[n - 1][0]} ${height} L${xy[0][0]} ${height} Z`} fill={colour} opacity={0.12} />
      <path d={d} fill="none" stroke={colour} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xy[n - 1][0]} cy={xy[n - 1][1]} r={2.5} fill={colour} />
    </svg>
  )
}

export interface BarSeries { key: string; label: string; tone: 'accent' | 'muted' | 'negative' }
export interface BarGroup { key: string; label: string; values: Record<string, { pct: string; text: string; negative?: boolean }> }

/** Vertical grouped bars (12 months of revenue vs expenses, net profit by month); hover shows the amounts. */
export function BarChart({ series, groups, height = 180, label, testId }: { series: BarSeries[]; groups: BarGroup[]; height?: number; label: string; testId?: string }) {
  const colour = { accent: 'var(--accent, var(--ink))', muted: 'var(--ink-muted)', negative: 'var(--negative)' }
  return (
    <figure style={{ margin: 0 }} data-testid={testId}>
      <div role="img" aria-label={`${label}: ${groups.map((g) => `${g.label} ${series.map((s) => `${s.label} ${g.values[s.key]?.text}`).join(', ')}`).join('; ')}`}
        style={{ display: 'grid', gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))`, gap: 6, alignItems: 'end', height, borderBottom: '1px solid var(--line)' }}>
        {groups.map((g) => (
          <div key={g.key} title={`${g.label}\n${series.map((s) => `${s.label}: ${g.values[s.key]?.text}`).join('\n')}`}
            style={{ display: 'flex', gap: 2, alignItems: 'end', justifyContent: 'center', height: '100%' }}>
            {series.map((s) => {
              const v = g.values[s.key]
              return <span key={s.key} style={{ width: `${Math.floor(70 / series.length)}%`, minWidth: 3, maxWidth: 18, height: `${Math.max(pct(v?.pct), v && pct(v.pct) > 0 ? 1.5 : 0)}%`,
                background: v?.negative ? colour.negative : colour[s.tone], borderRadius: '3px 3px 0 0', opacity: s.tone === 'muted' ? 0.45 : 1 }} />
            })}
          </div>
        ))}
      </div>
      <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))`, gap: 6, marginTop: 6 }}>
        {groups.map((g) => <span key={g.key} style={{ fontSize: 11, color: 'var(--ink-muted)', textAlign: 'center', overflow: 'hidden' }}>{g.label}</span>)}
      </div>
      {series.length > 1 && (
        <figcaption style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 12, color: 'var(--ink-muted)' }}>
          {series.map((s) => (
            <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: colour[s.tone], opacity: s.tone === 'muted' ? 0.45 : 1 }} />{s.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  )
}

/** Horizontal bar list (by category, aging buckets, by warehouse): name, bar, amount; a row with a link opens it. */
export function BarList({ rows, testId }: { rows: Array<{ key: string; label: string; value: ReactNode; pct: string; tone?: 'accent' | 'warning' | 'negative'; url?: string; note?: ReactNode }>; testId?: string }) {
  const navigate = useNavigate()
  const colour = { accent: 'var(--accent, var(--ink))', warning: 'var(--warning, var(--accent))', negative: 'var(--negative)' }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }} data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key}>
          <button type="button" disabled={!r.url} onClick={() => r.url && navigate(r.url)}
            style={{ display: 'grid', gap: 4, width: '100%', background: 'none', border: 0, padding: 0, textAlign: 'left', font: 'inherit', color: 'var(--ink)', cursor: r.url ? 'pointer' : 'default' }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}{r.note && <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}> · {r.note}</span>}</span>
              <span className="lf-num" style={{ flex: 'none' }}>{r.value}</span>
            </span>
            <span aria-hidden="true" style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${pct(r.pct)}%`, background: colour[r.tone ?? 'accent'], borderRadius: 3 }} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Area line from 0–100 points (30 days of the combined cash balance). */
export function LineChart({ points, first, last, label, height = 140, testId }: { points: string[]; first: string; last: string; label: string; height?: number; testId?: string }) {
  const w = 600
  const n = points.length
  if (n < 2) return null
  const xy = points.map((p, i) => [(i / (n - 1)) * w, height - 6 - (pct(p) / 100) * (height - 12)])
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  return (
    <figure style={{ margin: 0 }} data-testid={testId}>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={label}>
        <path d={`${d} L${w} ${height} L0 ${height} Z`} fill="var(--accent, var(--ink))" opacity={0.1} />
        <path d={d} fill="none" stroke="var(--accent, var(--ink))" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <figcaption style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-muted)' }}><span>{first}</span><span>{last}</span></figcaption>
    </figure>
  )
}
