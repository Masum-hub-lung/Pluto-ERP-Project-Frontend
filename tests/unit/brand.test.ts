import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BrandPalette } from '../../src/api/contract.gen'
import { applyBrand, BRAND_PRESETS, BRAND_VARIABLES, brandVariables, normaliseHex } from '../../src/lib/brand'

// PEP-497: what the API returns for a teal company (Me.brand)
const teal: BrandPalette = {
  color: '#0f766e',
  light: { brand: '#0f766e', brand_hover: '#0d6861', on_brand: '#ffffff', brand_ink: '#0f766e', brand_soft: '#e7f1f0', focus: '#0f766e' },
  dark: { brand: '#1fe0d0', brand_hover: '#43e6d8', on_brand: '#0b1320', brand_ink: '#43e6d8', brand_soft: '#133037', focus: '#43e6d8' },
}

const element = () => {
  const props = new Map<string, string>()
  return { props, style: { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => props.delete(k) } }
}

test('the six design-system variables come from the palette of the current theme', () => {
  assert.deepEqual(brandVariables(teal, 'light'), {
    '--brand': '#0f766e', '--brand-hover': '#0d6861', '--on-brand': '#ffffff', '--brand-ink': '#0f766e', '--brand-soft': '#e7f1f0', '--focus': '#0f766e',
  })
  assert.equal(brandVariables(teal, 'dark')?.['--brand'], '#1fe0d0')
  assert.equal(brandVariables(teal, 'dark')?.['--on-brand'], '#0b1320')
  assert.deepEqual(Object.keys(brandVariables(teal, 'dark')!), Object.values(BRAND_VARIABLES))
})

test('no palette means no variables: the Pluto default of lf-theme.css shows', () => {
  assert.equal(brandVariables(null, 'light'), null)
  assert.equal(brandVariables(undefined, 'dark'), null)
})

test('a value that is not #rrggbb is never written into a style', () => {
  const bad = { ...teal, light: { ...teal.light, brand_soft: 'red; background: url(x)' } }
  assert.equal(brandVariables(bad, 'light'), null)
  assert.notEqual(brandVariables(bad, 'dark'), null, 'the other theme is still usable')
  const missing = { ...teal, dark: { ...teal.dark, focus: undefined } } as unknown as BrandPalette
  assert.equal(brandVariables(missing, 'dark'), null)
})

test('applyBrand sets the variables, follows the theme and the company, and removes them again', () => {
  const el = element()
  applyBrand(el, teal, 'light')
  assert.equal(el.props.size, 6)
  assert.equal(el.props.get('--brand'), '#0f766e')
  applyBrand(el, teal, 'dark') // the user switches theme
  assert.equal(el.props.get('--brand'), '#1fe0d0')
  const maroon: BrandPalette = { ...teal, color: '#7f1d1d', dark: { ...teal.dark, brand: '#e88080' } }
  applyBrand(el, maroon, 'dark') // another company
  assert.equal(el.props.get('--brand'), '#e88080')
  applyBrand(el, null, 'dark') // a company without a colour
  assert.equal(el.props.size, 0)
})

test('normaliseHex accepts what people type and nothing else', () => {
  assert.equal(normaliseHex('#0F766E'), '#0f766e')
  assert.equal(normaliseHex(' 0f766e '), '#0f766e')
  assert.equal(normaliseHex('#0f7'), '#00ff77')
  for (const bad of ['', '#', 'teal', '#0f766', '#0f766ez', '#0f766e0', 'rgb(1,2,3)']) assert.equal(normaliseHex(bad), null, bad)
})

test('eight presets: Pluto blue is the default (saved as no colour), the others are #rrggbb', () => {
  assert.equal(BRAND_PRESETS.length, 8)
  assert.deepEqual(BRAND_PRESETS[0], { name: 'Pluto blue', value: '', swatch: '#1f3a5f' })
  assert.deepEqual(BRAND_PRESETS.map((p) => p.name), ['Pluto blue', 'Teal', 'Green', 'Maroon', 'Purple', 'Indigo', 'Slate', 'Burnt orange'])
  for (const p of BRAND_PRESETS.slice(1)) {
    assert.equal(p.value, p.swatch)
    assert.equal(normaliseHex(p.value), p.value)
  }
  assert.equal(new Set(BRAND_PRESETS.map((p) => p.swatch)).size, 8)
})
