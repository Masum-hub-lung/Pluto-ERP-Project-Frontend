// Vite build and dev server (backlog P0.5-FE-01). The SPA is served at the site root; /api goes to the backend:
// locally through this proxy (VITE_DEV_API_TARGET, default the Docker backend), live through the Vercel /api proxy.
// changeOrigin rewrites Host but keeps Origin (http://localhost:5173 / :4173), which the backend allows.
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const api = { '/api': { target: env.VITE_DEV_API_TARGET || 'http://localhost:8080', changeOrigin: true } }
  return {
    base: '/',
    plugins: [react()],
    server: { port: 5173, strictPort: true, proxy: api },
    preview: { port: 4173, proxy: api },
    build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  }
})
