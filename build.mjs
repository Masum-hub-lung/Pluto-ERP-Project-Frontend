/**
 * Production build with esbuild (the bundler Vite uses internally; Vite itself was not installable in the
 * build workspace). Output: dist/ (served at /app/). `--embed` also copies dist/ into ../backend/public/app,
 * where Laravel serves it same-origin with the API (routes/web.php).
 */
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'

const dev = process.argv.includes('--dev')
rmSync('dist', { recursive: true, force: true })
mkdirSync('dist/assets', { recursive: true })
await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: 'dist/assets',
  entryNames: 'app',
  chunkNames: 'chunk-[hash]',
  target: ['es2022'],
  jsx: 'automatic',
  minify: !dev,
  sourcemap: dev, // production maps are uploaded privately to error tracking, never served (07 §10)
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'), __DEV__: String(dev) },
  logLevel: 'info',
})
cpSync('public', 'dist', { recursive: true })
writeFileSync('dist/index.html', readFileSync('index.html', 'utf8'))
if (process.argv.includes('--embed')) {
  rmSync('../backend/public/app', { recursive: true, force: true })
  cpSync('dist', '../backend/public/app', { recursive: true })
  console.log('copied dist -> ../backend/public/app')
}
