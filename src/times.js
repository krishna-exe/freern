const DAY = 86400000

export function freeState(freeFrom, freeUntil, now) {
  if (!freeUntil || new Date(freeUntil).getTime() <= now) return 'off'
  return freeFrom && new Date(freeFrom).getTime() > now ? 'later' : 'on'
}

export const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const atTime = (hhmm, now) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(now).setHours(h, m, 0, 0)
}

// Turns two times of day into real instants: an end before the start runs past
// midnight, and a window that's already over means tomorrow.
export function resolveWindow(fromTime, untilTime, now) {
  let from = atTime(fromTime, now)
  let until = atTime(untilTime, now)
  if (until <= from) until += DAY
  if (until <= now) { from += DAY; until += DAY }
  return { from: new Date(from).toISOString(), until: new Date(until).toISOString() }
}

export const toTimeInput = (t) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const toDateTimeInput = (t) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${toTimeInput(d)}`
}

const dayLabel = (t, now) => {
  const days = Math.round((new Date(t).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

export const whenLabel = (t, now) => `${dayLabel(t, now)}, ${clock(t)}`
export const rangeLabel = (from, until, now) => `${dayLabel(from, now)}, ${clock(from)} – ${clock(until)}`
