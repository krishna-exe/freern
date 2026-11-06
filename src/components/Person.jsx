import { whatsappLink } from '../lib/api'
import { activeNote, clock, freeState, rangeLabel } from '../lib/times'

export function Avatar({ person, large, small }) {
  const initials = person.name.trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase()
  let hue = 0
  for (const c of person.handle) hue = (hue * 31 + c.charCodeAt(0)) % 360
  const className = `avatar${large ? ' large' : ''}${small ? ' small' : ''}${person.avatar ? ' picture' : ''}`
  return <span className={className} style={{ '--hue': hue }} aria-hidden="true">{person.avatar ?? initials}</span>
}

export function Person({ person, children }) {
  return (
    <span className="person">
      <span className="name">{person.name}</span>
      <span className="handle">@{person.handle}</span>
      {children}
    </span>
  )
}

export function FriendNote({ friend, now }) {
  const note = activeNote(friend, now)
  return note ? <span className="friend-note">{note}</span> : null
}

export function statusLabel(friend, now) {
  const state = freeState(friend.freeFrom, friend.freeUntil, now)
  if (state === 'on') return `till ${clock(friend.freeUntil)}`
  if (state === 'later') return rangeLabel(friend.freeFrom, friend.freeUntil, now)
  return ''
}

export function MessageLink({ friend, withLabel }) {
  if (!friend.whatsapp) return null
  return (
    <a className={withLabel ? 'message with-label' : 'message'} href={whatsappLink(friend.whatsapp)} target="_blank" rel="noreferrer" aria-label={`Message ${friend.name} on WhatsApp`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a8 8 0 0 1-11.8 7L4 20.5 5.5 15.5A8 8 0 1 1 21 12Z" />
      </svg>
      {withLabel && 'Message'}
    </a>
  )
}

const MOST_FACES = 5

export function Faces({ people, label }) {
  const extra = people.length - MOST_FACES
  return (
    <span className="faces" role="img" aria-label={label}>
      {people.slice(0, MOST_FACES).map((person) => <Avatar key={person.id} person={person} small />)}
      {extra > 0 && <span className="faces-more">+{extra}</span>}
    </span>
  )
}
