import { useEffect, useState } from 'react'

/** L10 slow load (02 #page-l10): after 8 s of waiting, say so instead of leaving a silent skeleton. */
export function StillLoading({ after = 8000 }: { after?: number }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShow(true), after)
    return () => clearTimeout(t)
  }, [after])
  if (!show) return null
  return <p role="status" style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 13 }}>Still loading… the server is taking longer than usual.</p>
}
