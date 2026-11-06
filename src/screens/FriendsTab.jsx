import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { freeState } from '../lib/times'
import { Avatar, FriendNote, MessageLink, Person, statusLabel } from '../components/Person'
import { Groups } from './Groups'
import { ProfileCard } from './Profile'

const STATE_ORDER = { on: 0, later: 1, off: 2 }

// People you could talk to now come first.
function sortedForList(friends, now) {
  const rank = (f) => STATE_ORDER[freeState(f.freeFrom, f.freeUntil, now)]
  return [...friends].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

const ADD_MESSAGES = {
  requested: (h) => `Request sent to @${h}.`,
  accepted: (h) => `You and @${h} are now friends.`,
  already_requested: (h) => `You’ve already asked @${h}.`,
  already_friends: (h) => `You and @${h} are already friends.`,
  self: () => 'That’s your own ID.',
  you_blocked: (h) => `You’ve blocked @${h}. Unblock them first.`,
  not_found: (h) => `No one has the ID @${h}. Check the spelling.`,
}

export function FriendsTab({ data, myId, now, run, invite, onInviteUsed, onRemoveFriend, onBlock, onOpenSettings }) {
  const [adding, setAdding] = useState(Boolean(invite))
  const [value, setValue] = useState(invite)
  const [message, setMessage] = useState('')
  const friends = sortedForList(data.friends, now)

  useEffect(() => {
    if (!invite) return
    setValue(invite)
    setAdding(true)
    setMessage('')
  }, [invite])

  async function submit(e) {
    e.preventDefault()
    const h = api.normalizeHandle(value)
    if (!h) return
    const result = await run(() => api.addFriend(h))
    if (!result) return
    setMessage(ADD_MESSAGES[result]?.(h) ?? '')
    onInviteUsed()
    if (result !== 'not_found' && result !== 'self') {
      setValue('')
      setAdding(false)
    }
  }

  function cancel() {
    setAdding(false)
    setValue('')
    setMessage('')
    onInviteUsed()
  }

  return (
    <>
      <header className="tab-header">
        <h1 className="grow">Friends</h1>
        <button className="icon-button" aria-label="Settings" onClick={onOpenSettings}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="8" cy="17" r="2" />
          </svg>
        </button>
        {!adding && <button className="primary small" onClick={() => { setAdding(true); setMessage('') }}>Add friend</button>}
      </header>

      {adding && (
        <form className="stack card" onSubmit={submit}>
          <label>
            Friend’s user ID
            <input value={value} onChange={(e) => { setValue(e.target.value); setMessage('') }} required autoFocus
              autoCapitalize="none" autoCorrect="off" spellCheck="false" />
          </label>
          <div className="form-actions">
            <button className="primary small">Add</button>
            <button type="button" className="quiet" onClick={cancel}>Cancel</button>
          </div>
        </form>
      )}
      {message && <p className="note flush" role="status">{message}</p>}

      {data.incoming.length > 0 && (
        <section>
          <h2>Requests</h2>
          <ul className="list">
            {data.incoming.map((p) => (
              <li key={p.id} className="row">
                <Avatar person={p} />
                <Person person={p} />
                <div className="actions">
                  <button className="primary small" onClick={() => run(() => api.acceptFriend(p.id))}>Accept</button>
                  <button className="quiet" onClick={() => run(() => api.removeLink(myId, p.id))}>Decline</button>
                  <button className="quiet" aria-label={`Block ${p.name}`} onClick={() => onBlock(p)}>Block</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {friends.length > 0
        ? <ul className="list">{friends.map((f) => <FriendRow key={f.id} friend={f} now={now} run={run} onNudged={setMessage}
          onRemove={() => onRemoveFriend(f)} onBlock={() => onBlock(f)} />)}</ul>
        : data.incoming.length === 0 && !adding && (
          <section className="empty">
            <p className="empty-title">No friends yet</p>
            <p className="note">Send them your link below, or add their user ID.</p>
          </section>
        )}

      {data.outgoing.length > 0 && (
        <section>
          <h2>Waiting on</h2>
          <ul className="list">
            {data.outgoing.map((p) => (
              <li key={p.id} className="row">
                <Avatar person={p} />
                <Person person={p} />
                <button className="quiet" onClick={() => run(() => api.removeLink(myId, p.id))}>Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {friends.length > 0 && <Groups groups={data.groups} friends={friends} run={run} />}

      <ProfileCard me={data.me} />
    </>
  )
}

// Remove stays out of the way until you tap a person.
function FriendRow({ friend, now, run, onNudged, onRemove, onBlock }) {
  const [open, setOpen] = useState(false)
  const state = freeState(friend.freeFrom, friend.freeUntil, now)

  async function askIfFree() {
    const result = await run(() => api.nudge(friend.id))
    if (result) onNudged(result === 'sent' ? `Asked ${friend.name} if they’re free.` : `You already asked ${friend.name} recently.`)
  }

  return (
    <li className={state === 'on' ? 'friend is-on' : 'friend'}>
      <button className="row row-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Avatar person={friend} />
        <Person person={friend}>
          <FriendNote friend={friend} now={now} />
          {friend.usually && <span className="handle wrap">Usually {friend.usually}</span>}
        </Person>
        <span className="when">{statusLabel(friend, now)}</span>
      </button>
      {open && (
        <div className="row-extra">
          <MessageLink friend={friend} withLabel />
          {state === 'off' && <button className="text-action" onClick={askIfFree}>You free?</button>}
          <label className="check notify-toggle">
            <input type="checkbox" defaultChecked={!friend.muted}
              onChange={(e) => run(() => api.setFriendNotify(friend.id, e.target.checked))} />
            Notify me
          </label>
          <button className="danger-link" aria-label={`Remove ${friend.name}`}
            onClick={onRemove}>Remove friend</button>
          <button className="danger-link" aria-label={`Block ${friend.name}`} onClick={onBlock}>Block</button>
        </div>
      )}
    </li>
  )
}
