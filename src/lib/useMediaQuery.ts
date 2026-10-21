import { useEffect, useState } from 'react'

/** True while the CSS media query matches (e.g. PHONE). Used where phone and wider layouts render different markup. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

/** Phone layout for lists, forms and dialogs (backlog P1.5-FE-03/04). The shell's own breakpoint is 900 px. */
export const PHONE = '(max-width: 639px)'
