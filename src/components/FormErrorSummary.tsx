import { lf } from '../ds'

/**
 * L8 validation summary (02 #page-l8): "Fix N fields to save this <noun>" above the form. Field messages stay next
 * to their inputs; `messages` lists only errors that have no input on this form (from applyProblemToForm).
 */
export function FormErrorSummary({ count, noun, messages = [] }: { count: number; noun: string; messages?: string[] }) {
  const { Banner } = lf()
  if (count === 0 && messages.length === 0) return null
  const n = count + messages.length
  return (
    <div role="alert">
      <Banner tone="negative" title={`Fix ${n} ${n === 1 ? 'field' : 'fields'} to save this ${noun}`}>
        {count > 0 ? 'Fields that need attention are marked below.' : null}
        {messages.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{messages.map((m) => <li key={m}>{m}</li>)}</ul>}
      </Banner>
    </div>
  )
}
