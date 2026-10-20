import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { loadDesignSystem } from './ds'

/** Boot: load the existing LedgerFlow design-system bundle (it uses this app's React), then render. */
const root = createRoot(document.getElementById('root')!)

loadDesignSystem().then(async () => {
  const [{ SessionProvider }, { ToastProvider }, { router }] = await Promise.all([
    import('./auth/session'), import('./app/toast'), import('./app/router'),
  ])
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 }, mutations: { retry: 0 } },
  })
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </SessionProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}).catch((e: Error) => {
  root.render(<p role="alert" style={{ padding: 24, fontFamily: 'system-ui' }}>LedgerFlow could not start: {e.message}</p>)
})
