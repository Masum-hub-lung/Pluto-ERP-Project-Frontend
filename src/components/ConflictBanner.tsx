import { lf } from '../ds'

/** 409 version_conflict (BR-049, 02 #page-l8): someone else saved first; the user's edits stay in the form. */
export function ConflictBanner({ onReload, loading }: { onReload: () => void; loading?: boolean }) {
  const { Banner, Button } = lf()
  return (
    <Banner tone="warning" title="Someone else changed this record"
      action={<Button size="sm" variant="secondary" loading={loading} onClick={onReload}>Reload</Button>}>
      Your changes are kept below. Reload to see the latest version, then save again.
    </Banner>
  )
}
