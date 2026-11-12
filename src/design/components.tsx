/**
 * The Pluto design system, as source. Ported one-to-one from the prebuilt bundle
 * (public/ds/pluto/components/bundle.js) so every page renders exactly as before;
 * the public typing stays `PlutoLibrary` in src/ds.ts. Class names keep the `lf-` prefix (decision C17)
 * so public/ds/pluto/components/bundle.css → src/design/pluto.css styles them unchanged.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { ICONS } from './icons'

type P = any
const cx = (...a: unknown[]) => a.filter(Boolean).join(' ')

export function Icon({ name, size = 18, strokeWidth = 1.75, className, label, style }: P) {
  const inner = ICONS[name] || ''
  return (
    <svg className={cx('lf-icon', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : 'true'} aria-label={label}
      role={label ? 'img' : undefined} style={style} dangerouslySetInnerHTML={{ __html: inner }} />
  )
}
Icon.names = Object.keys(ICONS)

export function Kbd({ children, className }: P) {
  return <kbd className={cx('lf-kbd', className)}>{children}</kbd>
}

export function Button({ variant = 'secondary', size = 'md', icon, iconRight, loading, kbd, className, children, block, ...rest }: P) {
  const s = size === 'sm' ? 15 : 16
  return (
    <button type="button" {...rest} aria-busy={loading || undefined}
      className={cx('lf-btn', 'lf-btn-' + variant, size === 'sm' && 'lf-btn-sm', block && 'lf-btn-block', loading && 'is-loading', className)}>
      {loading ? <span className="lf-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={s} /> : null}
      {children != null && <span className="lf-btn-label">{children}</span>}
      {iconRight && <Icon name={iconRight} size={s} />}
      {kbd && <Kbd className="lf-btn-kbd">{kbd}</Kbd>}
    </button>
  )
}

export function IconButton({ icon, label, variant = 'ghost', size = 'md', badge, className, ...rest }: P) {
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={cx('lf-iconbtn', 'lf-iconbtn-' + variant, size === 'sm' && 'lf-iconbtn-sm', className)}>
      <Icon name={icon} size={size === 'sm' ? 16 : 18} />
      {badge ? <span className="lf-iconbtn-badge" aria-hidden="true">{badge}</span> : null}
    </button>
  )
}

export function Badge({ tone = 'neutral', dot, icon, className, children }: P) {
  return (
    <span className={cx('lf-badge', 'lf-badge-' + tone, className)}>
      {dot && <span className="lf-badge-dot" aria-hidden="true" />}
      {icon && <Icon name={icon} size={13} strokeWidth={2} />}
      {children}
    </span>
  )
}

/** Indian/Bangladeshi digit grouping: 1,23,45,678. */
function groupBD(intStr: string) {
  if (intStr.length <= 3) return intStr
  const last3 = intStr.slice(-3)
  let rest = intStr.slice(0, -3)
  const parts: string[] = []
  while (rest.length > 2) { parts.unshift(rest.slice(-2)); rest = rest.slice(0, -2) }
  if (rest) parts.unshift(rest)
  return parts.join(',') + ',' + last3
}

/** Display formatting only: amounts arrive from the backend as decimal strings (no money maths here). */
export function formatAmount(value: unknown, { decimals = 2, grouping = 'bd', compact = false }: { decimals?: number; grouping?: string; compact?: boolean } = {}) {
  const n = Math.abs(Number(value) || 0)
  if (compact) {
    if (n >= 1e7) return (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr'
    if (n >= 1e5) return (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L'
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  }
  const [i, d] = n.toFixed(decimals).split('.')
  const g = grouping === 'bd' ? groupBD(i) : i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return d ? g + '.' + d : g
}

export function Amount({ value, currency, decimals = 2, grouping = 'bd', compact, drcr, tone = 'auto', signed, size = 'md', className }: P) {
  const v = Number(value) || 0
  const neg = v < 0
  const body = formatAmount(v, { decimals, grouping, compact })
  let text = (currency ? currency + ' ' : '') + body
  if (drcr) text = text + ' ' + (neg ? 'Cr' : 'Dr')
  else if (signed && !neg && v !== 0) text = '+' + text
  else if (neg) text = '(' + text + ')'
  const toneCls = tone === 'auto' ? (drcr ? null : neg ? 'is-neg' : signed && v > 0 ? 'is-pos' : null) : tone === 'none' ? null : 'is-' + tone
  return <span className={cx('lf-amount', 'lf-amount-' + size, toneCls, className)}>{text}</span>
}

export function Field({ label, hint, error, required, term, children, className, htmlFor }: P) {
  return (
    <div className={cx('lf-field', error && 'is-invalid', className)}>
      {label && (
        <label className="lf-field-label" htmlFor={htmlFor}>
          {term ? <Term explain={term}>{label}</Term> : label}
          {required && <span className="lf-req" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? <div className="lf-field-error" role="alert"><Icon name="circle-alert" size={14} />{error}</div>
        : hint ? <div className="lf-field-hint">{hint}</div> : null}
    </div>
  )
}

export function Input({ icon, suffix, prefix, invalid, align, mono, size = 'md', className, ...rest }: P) {
  return (
    <div className={cx('lf-input', invalid && 'is-invalid', rest.disabled && 'is-disabled', rest.readOnly && 'is-readonly', size === 'sm' && 'lf-input-sm', className)}>
      {icon && <Icon name={icon} size={16} className="lf-input-icon" />}
      {prefix && <span className="lf-input-affix">{prefix}</span>}
      <input {...rest} aria-invalid={invalid || undefined} className={cx(align === 'right' && 'is-right', mono && 'is-mono')} />
      {suffix && <span className="lf-input-affix">{suffix}</span>}
    </div>
  )
}

export function SearchInput({ placeholder = 'Search…', kbd, ...rest }: P) {
  return <Input icon="search" placeholder={placeholder} type="search" suffix={kbd ? <Kbd>{kbd}</Kbd> : null} {...rest} />
}

export function Select({ options = [], invalid, size = 'md', className, ...rest }: P) {
  return (
    <div className={cx('lf-select', invalid && 'is-invalid', size === 'sm' && 'lf-input-sm', className)}>
      <select {...rest} aria-invalid={invalid || undefined}>
        {options.map((o: P) => {
          const opt = typeof o == 'string' ? { value: o, label: o } : o
          return <option key={opt.value} value={opt.value}>{opt.label}</option>
        })}
      </select>
      <Icon name="chevrons-up-down" size={15} className="lf-select-chevron" />
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function DateInput({ value, open: openProp, onChange, size, invalid, className }: P) {
  const [open, setOpen] = useState(!!openProp)
  const [sel, setSel] = useState(value || '2026-10-13')
  const d = new Date(sel + 'T00:00:00'), y = d.getFullYear(), m = d.getMonth()
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate()
  const cells: Array<number | null> = []
  for (let i = 0; i < (first + 6) % 7; i++) cells.push(null)
  for (let i = 1; i <= days; i++) cells.push(i)
  const label = String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[m] + ' ' + y
  return (
    <div className={cx('lf-date', className)}>
      <button type="button" className={cx('lf-input', 'lf-date-trigger', invalid && 'is-invalid', size === 'sm' && 'lf-input-sm')} onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="calendar" size={16} className="lf-input-icon" />
        <span className="lf-date-value">{label}</span>
      </button>
      {open && (
        <div className="lf-popover lf-cal" role="dialog" aria-label="Choose date">
          <div className="lf-cal-head">
            <span className="lf-cal-title">{MONTHS_LONG[m]} {y}</span>
            <span className="lf-cal-nav"><IconButton icon="chevron-left" label="Previous month" size="sm" /><IconButton icon="chevron-right" label="Next month" size="sm" /></span>
          </div>
          <div className="lf-cal-grid">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((w) => <span key={w} className="lf-cal-dow">{w}</span>)}
            {cells.map((c, i) => c == null ? <span key={'e' + i} /> : (
              <button type="button" key={i} className={cx('lf-cal-day', c === d.getDate() && 'is-selected', i % 7 === 4 && 'is-weekend')} onClick={() => {
                const nv = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(c).padStart(2, '0')
                setSel(nv); onChange && onChange(nv)
              }}>{c}</button>
            ))}
          </div>
          <div className="lf-cal-foot"><Button size="sm" variant="ghost">Today</Button><Button size="sm" variant="ghost">Start of FY</Button></div>
        </div>
      )}
    </div>
  )
}

export function Checkbox({ label, checked, indeterminate, onChange, disabled, ...rest }: P) {
  const [on, setOn] = useState(!!checked)
  useEffect(() => setOn(!!checked), [checked])
  return (
    <label className={cx('lf-check', disabled && 'is-disabled')}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => { setOn(e.target.checked); onChange && onChange(e.target.checked) }} {...rest} />
      <span className={cx('lf-check-box', indeterminate && 'is-indeterminate')} aria-hidden="true"><Icon name={indeterminate ? 'x' : 'check'} size={12} strokeWidth={3} /></span>
      {label && <span>{label}</span>}
    </label>
  )
}

/** Keeps its own on/off state after mount: remount (key) to reset it. */
export function Switch({ label, checked, onChange, disabled }: P) {
  const [on, setOn] = useState(!!checked)
  return (
    <label className={cx('lf-switch', disabled && 'is-disabled')}>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => { setOn(e.target.checked); onChange && onChange(e.target.checked) }} />
      <span className="lf-switch-track" aria-hidden="true"><span className="lf-switch-thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  )
}

export function Tabs({ items = [], value, onChange, className }: P) {
  const [cur, setCur] = useState(value != null ? value : items[0] && (items[0].value ?? items[0]))
  return (
    <div className={cx('lf-tabs', className)} role="tablist">
      {items.map((it: P) => {
        const o = typeof it == 'string' ? { value: it, label: it } as P : it, active = o.value === cur
        return (
          <button key={o.value} role="tab" aria-selected={active} className={cx('lf-tab', active && 'is-active')} onClick={() => { setCur(o.value); onChange && onChange(o.value) }}>
            {o.label}{o.count != null && <span className="lf-tab-count">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function Segmented({ options = [], value, onChange, size = 'md', className }: P) {
  const [cur, setCur] = useState(value != null ? value : options[0] && (options[0].value ?? options[0]))
  return (
    <div className={cx('lf-seg', size === 'sm' && 'lf-seg-sm', className)} role="radiogroup">
      {options.map((it: P) => {
        const o = typeof it == 'string' ? { value: it, label: it } as P : it, active = o.value === cur
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} className={cx('lf-seg-item', active && 'is-active')} onClick={() => { setCur(o.value); onChange && onChange(o.value) }}>
            {o.icon && <Icon name={o.icon} size={15} />}{o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Card({ title, subtitle, actions, footer, padding = 'md', className, children, ...rest }: P) {
  return (
    <section className={cx('lf-card', 'lf-card-pad-' + padding, className)} {...rest}>
      {(title || actions) && (
        <header className="lf-card-head">
          <div>{title && <h3 className="lf-card-title">{title}</h3>}{subtitle && <p className="lf-card-sub">{subtitle}</p>}</div>
          {actions && <div className="lf-card-actions">{actions}</div>}
        </header>
      )}
      <div className="lf-card-body">{children}</div>
      {footer && <footer className="lf-card-foot">{footer}</footer>}
    </section>
  )
}

export function Sparkline({ data = [], width = 96, height = 28, tone = 'brand', area = true }: P) {
  if (!data.length) return null
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1
  const pts = data.map((v: number, i: number) => [i / (data.length - 1) * (width - 2) + 1, height - 3 - (v - min) / span * (height - 6)])
  const d = pts.map((p: number[], i: number) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg className={cx('lf-spark', 'lf-spark-' + tone)} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {area && <path className="lf-spark-area" d={d + ` L${last[0]} ${height} L1 ${height} Z`} />}
      <path className="lf-spark-line" d={d} />
      <circle className="lf-spark-dot" cx={last[0]} cy={last[1]} r="2.5" />
    </svg>
  )
}

export function Delta({ value, suffix = '%', invert, label }: P) {
  const up = value >= 0
  return (
    <span className={cx('lf-delta', (invert ? !up : up) ? 'is-good' : 'is-bad')}>
      <Icon name={up ? 'arrow-up-right' : 'arrow-down-right'} size={14} strokeWidth={2.25} />
      <span className="lf-delta-v">{(up ? '+' : '−') + Math.abs(value).toFixed(1) + suffix}</span>
      {label && <span className="lf-delta-label">{label}</span>}
    </span>
  )
}

export function StatTile({ label, value, currency = '৳', compact, delta, invertDelta, deltaLabel = 'vs last month', trend, trendTone, term, foot, className }: P) {
  const auto = compact === 'auto' ? typeof value == 'number' && Math.abs(value) >= 1e7 : compact
  return (
    <div className={cx('lf-stat', className)}>
      <div className="lf-stat-top">
        <div className="lf-stat-label">{term ? <Term explain={term}>{label}</Term> : label}</div>
        {trend && <Sparkline data={trend} width={72} height={22} tone={trendTone || (delta != null && (invertDelta ? delta > 0 : delta < 0) ? 'slate' : 'brand')} />}
      </div>
      <div className="lf-stat-value">{typeof value == 'number' ? <Amount value={value} currency={currency} decimals={0} compact={auto} size="xl" tone="none" /> : value}</div>
      <div className="lf-stat-foot">{delta != null && <Delta value={delta} invert={invertDelta} label={deltaLabel} />}{foot}</div>
    </div>
  )
}

export function Tooltip({ content, side = 'top', children }: P) {
  return <span className="lf-tip" data-side={side}>{children}<span role="tooltip" className="lf-tip-bubble">{content}</span></span>
}

export function Term({ explain, children }: P) {
  return (
    <span className="lf-tip lf-term" tabIndex={0} data-side="top">
      {children}<span role="tooltip" className="lf-tip-bubble lf-tip-wide"><span className="lf-tip-term">{children}</span>{explain}</span>
    </span>
  )
}

export function DataTable({ columns = [], rows = [], totals, density = 'default', selectable, rowActions, sort: sortProp, onRowClick, caption, emptyState, loading, zebra, className, activeId }: P) {
  const [sort, setSort] = useState<P>(sortProp || null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  let data = rows
  if (sort) {
    const col = columns.find((c: P) => c.key === sort.key), get = col && col.sortValue ? col.sortValue : (r: P) => r[sort.key]
    data = [...rows].sort((a: P, b: P) => { const x = get(a), y = get(b); return (x > y ? 1 : x < y ? -1 : 0) * (sort.dir === 'asc' ? 1 : -1) })
  }
  const allOn = rows.length > 0 && rows.every((r: P, i: number) => selected[r.id ?? i])
  const someOn = rows.some((r: P, i: number) => selected[r.id ?? i])
  const right = (c: P) => (c.align === 'right' || c.type === 'amount' ? 'is-right' : null)
  const cell = (c: P, r: P) => c.render ? c.render(r[c.key], r)
    : c.type === 'amount' ? (r[c.key] == null ? null : <Amount value={r[c.key]} decimals={c.decimals ?? 2} drcr={c.drcr} />) : r[c.key]
  const span = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)
  return (
    // Focusable region so keyboard users can scroll a wide table on a phone (axe scrollable-region-focusable; PEP-478).
    <div className={cx('lf-table-wrap', className)} tabIndex={0} role="region" aria-label={caption || 'Table'}>
      <table className={cx('lf-table', density === 'compact' && 'is-compact', zebra && 'is-zebra')}>
        {caption && <caption className="lf-sr">{caption}</caption>}
        <thead>
          <tr>
            {selectable && (
              <th className="lf-td-check">
                <Checkbox checked={allOn} indeterminate={!allOn && someOn} aria-label="Select all" onChange={(on: boolean) => {
                  const s: Record<string, boolean> = {}
                  if (on) rows.forEach((r: P, i: number) => { s[r.id ?? i] = true })
                  setSelected(s)
                }} />
              </th>
            )}
            {columns.map((c: P) => {
              const active = sort && sort.key === c.key
              return (
                <th key={c.key} style={{ width: c.width }} className={cx(right(c), c.wash && 'is-' + c.wash)} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortable ? (
                    <button type="button" className={cx('lf-th-sort', active && 'is-active')} onClick={() => setSort({ key: c.key, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}>
                      {c.label}<Icon name={active ? 'chevron-down' : 'arrow-up-down'} size={13} className={cx(active && sort.dir === 'asc' && 'is-flipped')} />
                    </button>
                  ) : c.term ? <Term explain={c.term}>{c.label}</Term> : c.label}
                </th>
              )
            })}
            {rowActions && <th className="lf-td-actions"><span className="lf-sr">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {loading ? Array.from({ length: 5 }).map((_, i) => (
            <tr key={i} className="is-loading">
              {selectable && <td className="lf-td-check"><Skeleton width={16} height={16} /></td>}
              {columns.map((c: P, j: number) => <td key={c.key} className={cx(c.type === 'amount' && 'is-right')}><Skeleton width={c.type === 'amount' ? 72 : j === 0 ? 120 : 90} height={12} /></td>)}
              {rowActions && <td />}
            </tr>
          )) : data.length === 0 ? (
            <tr><td colSpan={span} className="lf-td-empty">{emptyState || <EmptyState icon="search" title="No matching records" description="Try a different date range or clear filters." />}</td></tr>
          ) : data.map((r: P, i: number) => {
            const id = r.id ?? i
            return (
              <tr key={id} className={cx(selected[id] && 'is-selected', activeId != null && activeId === r.id && 'is-active', r._kind && 'is-' + r._kind, onRowClick && 'is-clickable')} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {selectable && (
                  <td className="lf-td-check" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={!!selected[id]} aria-label="Select row" onChange={(on: boolean) => setSelected({ ...selected, [id]: on })} />
                  </td>
                )}
                {columns.map((c: P) => (
                  <td key={c.key} className={cx(right(c), c.type === 'amount' && 'is-num', c.mono && 'is-mono', c.wash && 'is-' + c.wash, c.indentKey && 'is-indent')}
                    style={c.indentKey ? { paddingLeft: 12 + (r[c.indentKey] || 0) * 20 } : undefined}>{cell(c, r)}</td>
                ))}
                {rowActions && <td className="lf-td-actions" onClick={(e) => e.stopPropagation()}><div className="lf-row-actions">{rowActions(r)}</div></td>}
              </tr>
            )
          })}
        </tbody>
        {totals && (
          <tfoot>
            {(Array.isArray(totals) ? totals : [totals]).map((t: P, k: number) => (
              <tr key={k} className={cx('lf-total', t._grand && 'is-grand')}>
                {selectable && <td />}
                {columns.map((c: P) => (
                  <td key={c.key} className={cx(c.align === 'right' || c.type === 'amount' ? 'is-right is-num' : null, c.wash && 'is-' + c.wash)}>
                    {t[c.key] == null ? null : c.type === 'amount' && typeof t[c.key] == 'number' ? <Amount value={t[c.key]} decimals={c.decimals ?? 2} drcr={c.drcr} /> : t[c.key]}
                  </td>
                ))}
                {rowActions && <td />}
              </tr>
            ))}
          </tfoot>
        )}
      </table>
    </div>
  )
}

export function Pagination({ page = 1, pageCount = 1, total, pageSize = 25, onChange }: P) {
  const [p, setP] = useState(page)
  const go = (n: number) => { const v = Math.min(pageCount, Math.max(1, n)); setP(v); onChange && onChange(v) }
  const nums: Array<number | string> = []
  for (let i = 1; i <= pageCount; i++) {
    if (i === 1 || i === pageCount || Math.abs(i - p) <= 1) nums.push(i)
    else if (nums[nums.length - 1] !== '…') nums.push('…')
  }
  const from = (p - 1) * pageSize + 1, to = Math.min(total != null ? total : p * pageSize, p * pageSize)
  return (
    <nav className="lf-pager" aria-label="Pagination">
      {total != null && <span className="lf-pager-info">{from}{'–'}{to}{' of '}{total.toLocaleString('en-IN')}</span>}
      <div className="lf-pager-pages">
        <IconButton icon="chevron-left" label="Previous page" size="sm" variant="secondary" disabled={p === 1} onClick={() => go(p - 1)} />
        {nums.map((n, i) => n === '…' ? <span key={'g' + i} className="lf-pager-gap">{'…'}</span> : (
          <button key={n} type="button" className={cx('lf-pager-num', n === p && 'is-active')} aria-current={n === p ? 'page' : undefined} onClick={() => go(n as number)}>{n}</button>
        ))}
        <IconButton icon="chevron-right" label="Next page" size="sm" variant="secondary" disabled={p === pageCount} onClick={() => go(p + 1)} />
      </div>
    </nav>
  )
}

export function Dialog({ open = true, title, description, tone, children, footer, onClose, inline, width = 480 }: P) {
  if (!open) return null
  const box = (
    <div className={cx('lf-dialog', tone && 'lf-dialog-' + tone)} role="dialog" aria-modal={!inline} aria-label={typeof title == 'string' ? title : undefined} style={{ width }}>
      <div className="lf-dialog-head">
        {tone && <span className={cx('lf-dialog-icon', 'is-' + tone)}><Icon name={tone === 'danger' ? 'triangle-alert' : tone === 'success' ? 'circle-check' : 'info'} size={20} /></span>}
        <div className="lf-dialog-titles"><h2 className="lf-dialog-title">{title}</h2>{description && <p className="lf-dialog-desc">{description}</p>}</div>
        <IconButton icon="x" label="Close" size="sm" onClick={onClose} />
      </div>
      {children && <div className="lf-dialog-body">{children}</div>}
      {footer && <div className="lf-dialog-foot">{footer}</div>}
    </div>
  )
  return inline ? <div className="lf-scrim is-inline">{box}</div>
    : <div className="lf-scrim" onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>{box}</div>
}

export function Drawer({ open = true, title, subtitle, children, footer, onClose, inline, width = 440 }: P) {
  return open ? (
    <div className={cx('lf-drawer-scrim', inline && 'is-inline')} onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <aside className="lf-drawer" role="dialog" aria-label={typeof title == 'string' ? title : undefined} style={{ width }}>
        <div className="lf-drawer-head">
          <div><h2 className="lf-dialog-title">{title}</h2>{subtitle && <p className="lf-dialog-desc">{subtitle}</p>}</div>
          <IconButton icon="x" label="Close" size="sm" onClick={onClose} />
        </div>
        <div className="lf-drawer-body">{children}</div>
        {footer && <div className="lf-drawer-foot">{footer}</div>}
      </aside>
    </div>
  ) : null
}

export function Menu({ items = [], className, style }: P) {
  return (
    <div className={cx('lf-popover', 'lf-menu', className)} role="menu" style={style}>
      {items.map((it: P, i: number) => it === '-' ? <div key={i} className="lf-menu-sep" role="separator" />
        : it.heading ? <div key={i} className="lf-menu-heading">{it.heading}</div> : (
          <button key={i} type="button" role="menuitem" className={cx('lf-menu-item', it.danger && 'is-danger', it.active && 'is-active')} onClick={it.onClick}>
            {it.icon && <Icon name={it.icon} size={16} />}
            <span className="lf-menu-label">{it.label}{it.description && <span className="lf-menu-desc">{it.description}</span>}</span>
            {it.kbd && <Kbd>{it.kbd}</Kbd>}
          </button>
        ))}
    </div>
  )
}

export function Dropdown({ trigger, items, align = 'start', defaultOpen }: P) {
  const [open, setOpen] = useState(!!defaultOpen)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div className={cx('lf-dropdown', 'is-' + align)} ref={ref}>
      <span onClick={() => setOpen(!open)}>{trigger}</span>
      {open && <Menu items={items.map((it: P) => it === '-' || it.heading ? it : { ...it, onClick: () => { setOpen(false); it.onClick && it.onClick() } })} />}
    </div>
  )
}

const TONE_ICON: Record<string, string> = { positive: 'circle-check', negative: 'circle-alert', warning: 'triangle-alert', info: 'info', neutral: 'info' }

export function Banner({ tone = 'info', title, children, action, onDismiss, className }: P) {
  return (
    <div className={cx('lf-banner', 'lf-banner-' + tone, className)} role={tone === 'negative' ? 'alert' : 'status'}>
      <Icon name={TONE_ICON[tone]} size={18} className="lf-banner-icon" />
      <div className="lf-banner-text">{title && <strong>{title}</strong>}{children && <span>{children}</span>}</div>
      {action && <div className="lf-banner-action">{action}</div>}
      {onDismiss && <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} />}
    </div>
  )
}

export function Toast({ tone = 'positive', title, description, action, onDismiss }: P) {
  return (
    <div className={cx('lf-toast', 'lf-toast-' + tone)} role="status">
      <span className={cx('lf-toast-icon', 'is-' + tone)}><Icon name={TONE_ICON[tone]} size={18} /></span>
      <div className="lf-toast-text"><strong>{title}</strong>{description && <span>{description}</span>}</div>
      {action}
      <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} />
    </div>
  )
}

export function Skeleton({ width = '100%', height = 12, radius, className }: P) {
  return <span className={cx('lf-skel', className)} style={{ width, height, borderRadius: radius }} aria-hidden="true" />
}

export function EmptyState({ icon = 'file-text', title, description, action, secondary }: P) {
  return (
    <div className="lf-empty">
      <div className="lf-empty-art" aria-hidden="true">
        <span className="lf-empty-rule" /><span className="lf-empty-rule is-short" />
        <span className="lf-empty-icon"><Icon name={icon} size={22} /></span>
      </div>
      <h3 className="lf-empty-title">{title}</h3>
      {description && <p className="lf-empty-desc">{description}</p>}
      {(action || secondary) && <div className="lf-empty-actions">{action}{secondary}</div>}
    </div>
  )
}

/** Visual check only: the backend decides whether a voucher balances. */
export function BalanceStatus({ debit = 0, credit = 0, currency = '৳' }: P) {
  const diff = Math.round((debit - credit) * 100) / 100, ok = diff === 0 && debit > 0, max = Math.max(debit, credit, 1)
  return (
    <div className={cx('lf-balance', ok ? 'is-ok' : 'is-off')} role="status" aria-live="polite">
      <div className="lf-balance-cols">
        <div className="lf-balance-col">
          <span className="lf-balance-label">Total debit</span><Amount value={debit} currency={currency} size="lg" tone="none" />
          <span className="lf-balance-bar"><span className="is-dr" style={{ width: debit / max * 100 + '%' }} /></span>
        </div>
        <div className="lf-balance-col">
          <span className="lf-balance-label">Total credit</span><Amount value={credit} currency={currency} size="lg" tone="none" />
          <span className="lf-balance-bar"><span className="is-cr" style={{ width: credit / max * 100 + '%' }} /></span>
        </div>
      </div>
      <div className="lf-balance-verdict">
        <Icon name={ok ? 'circle-check' : 'scale'} size={18} />
        {ok ? <span><strong>Balanced.</strong> Debits equal credits.</span> : (
          <span><strong>Out of balance by <Amount value={Math.abs(diff)} currency={currency} tone="none" /></strong> {diff > 0 ? '— add a credit line.' : '— add a debit line.'}</span>
        )}
      </div>
    </div>
  )
}

export function Avatar({ name = '', size = 32, tone = 'brand' }: P) {
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s: string) => s[0]).join('').toUpperCase()
  return <span className={cx('lf-avatar', 'lf-avatar-' + tone)} style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{ini}</span>
}

export function Logo({ compact, reversed = true }: P) {
  return (
    <span className={cx('lf-logo', reversed && 'is-reversed')}>
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className="lf-logo-mark">
        <rect width="32" height="32" rx="8" className="lf-logo-tile" />
        <rect x="7" y="8" width="10" height="3.2" rx="1.6" className="lf-logo-bar" />
        <rect x="7" y="13.6" width="15" height="3.2" rx="1.6" className="lf-logo-bar" />
        <rect x="7" y="20.4" width="18" height="1.6" rx="0.8" className="lf-logo-rule" />
        <rect x="7" y="23.6" width="18" height="1.6" rx="0.8" className="lf-logo-rule" />
      </svg>
      {!compact && <span className="lf-logo-word">Pluto</span>}
    </span>
  )
}

const NavCtx = createContext(false)

export function NavItem({ icon, label, active, count, compact: compactProp, children, open: openProp, onClick }: P) {
  const ctx = useContext(NavCtx), compact = compactProp != null ? compactProp : ctx
  const [open, setOpen] = useState(!!openProp || !!active)
  const hasKids = !!children
  return (
    <div className={cx('lf-nav-group', open && 'is-open')}>
      <button type="button" className={cx('lf-nav-item', active && !hasKids && 'is-active', active && hasKids && 'is-parent-active')}
        aria-current={active && !hasKids ? 'page' : undefined} aria-expanded={hasKids ? open : undefined}
        onClick={() => { if (hasKids) setOpen(!open); onClick && onClick() }} title={compact ? label : undefined}>
        <Icon name={icon} size={18} />
        {!compact && <span className="lf-nav-label">{label}</span>}
        {!compact && count != null && <span className="lf-nav-count">{count}</span>}
        {!compact && hasKids && <Icon name="chevron-down" size={15} className="lf-nav-caret" />}
        {compact && <span className="lf-nav-tip" role="tooltip">{label}</span>}
      </button>
      {hasKids && open && !compact && <div className="lf-nav-sub">{children}</div>}
    </div>
  )
}

export function NavSubItem({ label, active, onClick }: P) {
  return <button type="button" className={cx('lf-nav-subitem', active && 'is-active')} aria-current={active ? 'page' : undefined} onClick={onClick}>{label}</button>
}

export function Sidebar({ compact: compactProp = false, company = { name: 'Meghna Traders Ltd.', meta: 'Dhaka · BDT' }, user = { name: 'Rafiq Hasan', role: 'Finance Manager' }, children, onToggle, className }: P) {
  const [compact, setCompact] = useState(compactProp)
  useEffect(() => setCompact(compactProp), [compactProp])
  return (
    <NavCtx.Provider value={compact}>
      <nav className={cx('lf-sidebar', compact && 'is-compact', className)} aria-label="Main">
        <div className="lf-sidebar-top">
          <Logo compact={compact} />
          <IconButton icon={compact ? 'panel-left-open' : 'panel-left-close'} label={compact ? 'Expand sidebar' : 'Collapse sidebar'} size="sm" className="lf-sidebar-toggle"
            onClick={() => { setCompact(!compact); onToggle && onToggle(!compact) }} />
        </div>
        <button type="button" className="lf-company" title={compact ? company.name : undefined}>
          <span className="lf-company-badge">{company.name.split(/\s+/).slice(0, 2).map((s: string) => s[0]).join('')}</span>
          {!compact && <span className="lf-company-text"><span className="lf-company-name">{company.name}</span><span className="lf-company-meta">{company.meta}</span></span>}
          {!compact && <Icon name="chevrons-up-down" size={15} />}
        </button>
        <div className="lf-sidebar-nav">{children}</div>
        <div className="lf-sidebar-user">
          <Avatar name={user.name} size={32} tone="accent" />
          {!compact && <span className="lf-company-text"><span className="lf-company-name">{user.name}</span><span className="lf-company-meta">{user.role}</span></span>}
          {!compact && <IconButton icon="settings" label="Settings" size="sm" className="lf-sidebar-toggle" />}
        </div>
      </nav>
    </NavCtx.Provider>
  )
}

export function NavSection({ label, compact: compactProp, children }: P) {
  const ctx = useContext(NavCtx)
  const compact = compactProp != null ? compactProp : ctx
  return (
    <div className="lf-nav-section">
      {label && (compact ? <div className="lf-nav-sep" /> : <div className="lf-nav-section-label">{label}</div>)}
      {children}
    </div>
  )
}

const CREATE_ITEMS: P[] = [{ heading: 'Vouchers' }, { icon: 'receipt-text', label: 'Sales invoice', kbd: 'Alt S' }, { icon: 'shopping-cart', label: 'Purchase bill', kbd: 'Alt P' },
  { icon: 'hand-coins', label: 'Receipt', kbd: 'Alt R' }, { icon: 'banknote', label: 'Payment', kbd: 'Alt Y' }, { icon: 'book-open-text', label: 'Journal voucher', kbd: 'Alt J' }, '-',
  { icon: 'users', label: 'Customer or supplier' }, { icon: 'package', label: 'Product' }]

export function Topbar({ breadcrumbs = [], company: _company, fy = 'FY 2026–27', notifications = 3, user = 'Rafiq Hasan', onSearch, onCreate, onCreateItem, onNotifications, onHelp, className }: P) {
  return (
    <header className={cx('lf-topbar', className)}>
      <ol className="lf-crumbs" aria-label="Breadcrumb">
        {breadcrumbs.map((b: P, i: number) => (
          <li key={i} aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined}>
            {i > 0 && <Icon name="chevron-right" size={14} className="lf-crumb-sep" />}<span>{b}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="lf-search-trigger" onClick={onSearch}>
        <Icon name="search" size={16} /><span>Search accounts, parties, vouchers{'…'}</span><Kbd>Ctrl K</Kbd>
      </button>
      <div className="lf-topbar-right">
        <button type="button" className="lf-context-chip"><Icon name="calendar" size={15} />{fy}<Icon name="chevron-down" size={14} /></button>
        <Dropdown align="end" trigger={<Button variant="primary" icon="plus" size="sm" onClick={onCreate}>Create</Button>}
          items={CREATE_ITEMS.map((it) => it && typeof it === 'object' && it.label && onCreateItem ? { ...it, onClick: () => onCreateItem(it.label) } : it)} />
        <IconButton icon="circle-help" label="Help" onClick={onHelp} />
        <IconButton icon="bell" label={notifications + ' notifications'} badge={notifications || null} onClick={onNotifications} />
        <Avatar name={user} size={30} tone="accent" />
      </div>
    </header>
  )
}

const CMDK_SAMPLE: P[] = [
  { heading: 'Accounts', items: [{ icon: 'book-open-text', label: 'Sonali Bank — Current A/c', meta: '1102-01 · Bank' }, { icon: 'book-open-text', label: 'Sales — Wholesale', meta: '4100-02 · Income' }] },
  { heading: 'Parties', items: [{ icon: 'users', label: 'Karim Distributors', meta: 'Customer · ৳ 3,42,000 due' }] },
  { heading: 'Actions', items: [{ icon: 'receipt-text', label: 'New sales invoice', kbd: 'Alt S' }, { icon: 'scale', label: 'Open trial balance', kbd: 'G T' }] },
]

export function CommandPalette({ open = true, inline, query = '', groups, onClose }: P) {
  const [q, setQ] = useState(query)
  const ql = q.trim().toLowerCase()
  const filtered = (groups || CMDK_SAMPLE).map((g: P) => ({ ...g, items: g.items.filter((it: P) => !ql || it.label.toLowerCase().includes(ql)) })).filter((g: P) => g.items.length)
  if (!open) return null
  let n = 0
  return (
    <div className={cx('lf-scrim', 'lf-scrim-top', inline && 'is-inline')} onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="lf-cmdk" role="dialog" aria-label="Command palette">
        <div className="lf-cmdk-input"><Icon name="search" size={18} /><input autoFocus={!inline} value={q} onChange={(e) => setQ(e.target.value)} placeholder={'Type a command or search…'} /><Kbd>Esc</Kbd></div>
        <div className="lf-cmdk-list">
          {filtered.map((g: P) => (
            <div key={g.heading}>
              <div className="lf-menu-heading">{g.heading}</div>
              {g.items.map((it: P) => {
                const first = n++ === 0
                return (
                  <button type="button" key={it.label} className={cx('lf-menu-item', first && 'is-active')}>
                    <Icon name={it.icon} size={16} />
                    <span className="lf-menu-label">{it.label}{it.meta && <span className="lf-menu-desc">{it.meta}</span>}</span>
                    {it.kbd && <Kbd>{it.kbd}</Kbd>}
                  </button>
                )
              })}
            </div>
          ))}
          {!filtered.length && <div className="lf-cmdk-empty">No results for {'“'}{q}{'”'}</div>}
        </div>
        <div className="lf-cmdk-foot"><span><Kbd>{'↑'}</Kbd><Kbd>{'↓'}</Kbd> to move</span><span><Kbd>Enter</Kbd> to open</span></div>
      </div>
    </div>
  )
}

export function PageHeader({ eyebrow, title, description, actions, children }: P) {
  return (
    <div className="lf-pagehead">
      <div className="lf-pagehead-text">
        {eyebrow && <div className="lf-eyebrow">{eyebrow}</div>}
        <h1 className="lf-page-title">{title}</h1>
        {description && <p className="lf-page-desc">{description}</p>}
      </div>
      {actions && <div className="lf-pagehead-actions">{actions}</div>}
      {children}
    </div>
  )
}

export const library = {
  Amount, Avatar, Badge, BalanceStatus, Banner, Button, Card, Checkbox, CommandPalette, DataTable, DateInput, Delta, Dialog, Drawer, Dropdown,
  EmptyState, Field, Icon, IconButton, Input, Kbd, Logo, Menu, NavItem, NavSection, NavSubItem, PageHeader, Pagination, SearchInput, Segmented,
  Select, Sidebar, Skeleton, Sparkline, StatTile, Switch, Tabs, Term, Toast, Tooltip, Topbar, formatAmount,
}
