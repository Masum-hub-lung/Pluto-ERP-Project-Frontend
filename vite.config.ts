// Vite build and dev server (backlog P0.5-FE-01). The SPA is served at the site root; /api goes to the backend:
// locally through this proxy (VITE_DEV_API_TARGET, default the Docker backend), live through the Vercel /api proxy.
// changeOrigin rewrites Host but keeps Origin (http://localhost:5173 / :4173), which the backend allows.
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const api = { '/api': { target: env.VITE_DEV_API_TARGET || 'http://localhost:8080', changeOrigin: true } }
  // Private source maps (P17.2-FE-02): only when SENTRY_AUTH_TOKEN is set at build time (Vercel/CI secret), maps are
  // emitted hidden, uploaded to Sentry and deleted, so the deployed site never serves them.
  const sentry = env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT
  return {
    base: '/',
    plugins: [react(), ...(sentry ? [sentryVitePlugin({
      org: env.SENTRY_ORG, project: env.SENTRY_PROJECT, authToken: env.SENTRY_AUTH_TOKEN, telemetry: false,
      release: env.VITE_RELEASE ? { name: env.VITE_RELEASE } : undefined,
      sourcemaps: { filesToDeleteAfterUpload: ['**/*.map'] },
    })] : [])],
    server: { port: 5173, strictPort: true, proxy: api },
    preview: { port: 4173, proxy: api },
    build: { outDir: 'dist', sourcemap: sentry ? 'hidden' : false, target: 'es2022' },
  }
})
