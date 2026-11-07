const DAY = 86400000

// After this long, a friend's "last talked" line stands out.
const DRIFTING_AFTER_DAYS = 30

export const CONNECTION_KINDS = [
  { id: 'talked', label: 'Talked' },
  { id: 'hung_out', label: 'Hung out' },
  { id: 'texted', label: 'Texted' },
]

export const kindLabel = (id) => CONNECTION_KINDS.find((k) => k.id === id)?.label ?? ''

const startOfDay = (t) => new Date(t).setHours(0, 0, 0, 0)

// Whole calendar days, so last night counts as yesterday whatever the time is.
const daysSince = (at, now) => Math.round((startOfDay(now) - startOfDay(at)) / DAY)

function agoLabel(at, now) {
  const days = daysSince(at, now)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}

export const connectionLabel = ({ kind, at }, now) => `${kindLabel(kind)} ${agoLabel(at, now)}`

export const isDrifting = ({ at }, now) => daysSince(at, now) >= DRIFTING_AFTER_DAYS
