import { Navigate } from 'react-router-dom'
import { useSession } from '../../auth/session'
import { RAIL } from './SettingsLayout'

/** /settings opens the first section this user may see (Company profile for admins, Security for everyone). */
export function SettingsHome() {
  const { can } = useSession()
  const first = RAIL.flatMap((g) => g.items).find((it) => it.permission === null ? false : can(it.permission))
  return <Navigate to={first?.path ?? '/settings/security'} replace />
}
