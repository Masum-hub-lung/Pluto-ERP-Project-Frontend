/** Bundles tests/unit/*.test.ts with esbuild for Node and runs them with the built-in node:test runner. */
import { build } from 'esbuild'
import { readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const files = readdirSync('tests/unit').filter((f) => f.endsWith('.test.ts')).map((f) => `tests/unit/${f}`)
rmSync('.unit-build', { recursive: true, force: true })
await build({ entryPoints: files, bundle: true, platform: 'node', format: 'esm', outdir: '.unit-build', target: 'node22', logLevel: 'warning' })
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files.map((f) => `.unit-build/${f.split('/').pop().replace('.ts', '.js')}`)], { stdio: 'inherit' })
rmSync('.unit-build', { recursive: true, force: true })
process.exit(r.status ?? 1)
