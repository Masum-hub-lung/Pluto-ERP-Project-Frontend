import { useEffect, useMemo } from 'react'
import type { BrandPalette, BrandTokens } from '../api/contract.gen'

/**
 * Company brand colour (PEP-497): the server works out the colours for the light and the dark theme (Me.brand,
 * Company.brand); this only copies them onto the design system's CSS variables. No colour maths here. Without a
 * palette the variables are removed and the Pluto default of public/lf-theme.css shows again.
 */
export type Theme = 'light' | 'dark'

/** BrandTokens field → the CSS variable it sets. */
export const BRAND_VARIABLES: Record<keyof BrandTokens, string> = {
  brand: '--brand', brand_hover: '--brand-hover', on_brand: '--on-brand', brand_ink: '--brand-ink', brand_soft: '--brand-soft', focus: '--focus',
}

const HEX = /^#[0-9a-f]{6}$/i

/** The swatches of Settings › Company profile. `value: ''` is the Pluto default (saved as null). All pass the server's AA check. */
export const BRAND_PRESETS: ReadonlyArray<{ name: string; value: string; swatch: string }> = [
  { name: 'Pluto blue', value: '', swatch: '#1f3a5f' },
  { name: 'Teal', value: '#0f766e', swatch: '#0f766e' },
  { name: 'Green', value: '#166534', swatch: '#166534' },
  { name: 'Maroon', value: '#7f1d1d', swatch: '#7f1d1d' },
  { name: 'Purple', value: '#6b21a8', swatch: '#6b21a8' },
  { name: 'Indigo', value: '#3730a3', swatch: '#3730a3' },
  { name: 'Slate', value: '#334155', swatch: '#334155' },
  { name: 'Burnt orange', value: '#9a3412', swatch: '#9a3412' },
]

/** What the user typed → `#rrggbb` in lower case (the `#` may be missing, `#abc` is spelled out), or null when it is not a colour. */
export function normaliseHex(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^#?/, '#')
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  return HEX.test(s) ? s : null
}

/**
 * The six CSS variables for one theme, or null when there is no (usable) palette. A value that is not `#rrggbb` is
 * never written into a style: the whole palette is ignored and the default shows.
 */
export function brandVariables(palette: BrandPalette | null | undefined, theme: Theme): Record<string, string> | null {
  const tokens = palette?.[theme]
  if (!tokens) return null
  const out: Record<string, string> = {}
  for (const [field, variable] of Object.entries(BRAND_VARIABLES) as Array<[keyof BrandTokens, string]>) {
    const value = tokens[field]
    if (typeof value !== 'string' || !HEX.test(value)) return null
    out[variable] = value.toLowerCase()
  }
  return out
}

type StyleTarget = { style: { setProperty: (name: string, value: string) => void; removeProperty: (name: string) => unknown } }

/** Sets the variables on an element (the document root), or removes all six for no palette. */
export function applyBrand(target: StyleTarget, palette: BrandPalette | null | undefined, theme: Theme): void {
  const vars = brandVariables(palette, theme)
  for (const variable of Object.values(BRAND_VARIABLES)) {
    if (vars) target.style.setProperty(variable, vars[variable]!)
    else target.style.removeProperty(variable)
  }
}

/**
 * Colours the app with the current company's brand for the current theme. The variables go on <html> (dialogs and
 * menus render outside the shell) and are returned as a style for the element that carries `data-theme` — that
 * element re-declares the theme's own colours, so <html> alone would not reach the pages. Removed on unmount, so
 * the sign-in pages stay Pluto's.
 */
export function useBrandColours(palette: BrandPalette | null | undefined, theme: Theme): Record<string, string> {
  useEffect(() => {
    applyBrand(document.documentElement, palette, theme)
    return () => applyBrand(document.documentElement, null, theme)
  }, [palette, theme])
  return useMemo(() => brandVariables(palette, theme) ?? {}, [palette, theme])
}
