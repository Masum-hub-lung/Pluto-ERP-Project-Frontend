import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'

/**
 * L13 unsaved changes (02 #page-l13): while `dirty`, leaving the page in the app asks "Keep editing / Discard
 * changes", and closing or reloading the tab shows the browser's warning. Call `allowNavigation()` right before
 * navigating away after a successful save (the form is still marked dirty until it re-renders). Render `dialog`.
 */
export function useUnsavedChangesBlocker(dirty: boolean, description = 'Your edits have not been saved.') {
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const allowRef = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirtyRef.current && !allowRef.current && currentLocation.pathname !== nextLocation.pathname)

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const dialog = blocker.state === 'blocked'
    ? <ConfirmDialog title="Discard unsaved changes?" description={description} confirmLabel="Discard changes" cancelLabel="Keep editing"
        onConfirm={() => blocker.proceed?.()} onClose={() => blocker.reset?.()} />
    : null

  return { dialog, allowNavigation: () => { allowRef.current = true } }
}
