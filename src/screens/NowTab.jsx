import { useState } from 'react'
import * as api from '../lib/api'
import { activeNote, clock, freeState, rangeLabel, resolveWindow, toTimeInput } from '../lib/times'
import { Avatar, FriendNote, LastConnection, MessageLink, statusLabel } from '../components/Person'

const HOUR = 3600000
const iso = (ms) => new Date(ms).toISOString()
const NOTE_SHORTCUTS = ['Call me', 'Down to hang', 'Only texting']

export function NowTab({ data, now, run, setMine, onAddFriends, onOpenFriend }) {
  const inState = (state) => data.friends
    .filter((f) => freeState(f.freeFrom, f.freeUntil, now) === state)
    .sort((a, b) => a.name.localeCompare(b.name))
  const onFriends = inState('on'), laterFriends = inState('later')
  const myState = freeState(data.me.freeFrom, data.me.freeUntil, now)
  const on = myState === 'on'

  return (
    <>
      <h1 className="sr-only">Free RN</h1>
      <div className="stack-tight">
        <Switch state={myState} me={data.me} now={now}
          onToggle={() => setMine(null, on ? null : iso(Date.now() + 2 * HOUR), () => api.setFree(!on))} />
        <TimeControls state={myState} me={data.me} now={now} setMine={setMine} />
        <MyNote note={activeNote(data.me, now)} run={run} />
      </div>

      {myState !== 'on' && data.nudges.map((person) => (
        <div key={person.id} className="card banner">
          <Avatar person={person} />
          <span className="grow">{person.name} asked if you’re free</span>
          <button className="quiet" aria-label={`Dismiss ${person.name}`} onClick={() => run(() => api.dismissNudge(person.id))}>Dismiss</button>
        </div>
      ))}

      {data.friends.length === 0
        ? (
          <section className="empty">
            <p className="empty-title">See who’s free</p>
            <p className="note">Add a friend and they’ll show up here when they’re on.</p>
            <button className="primary" onClick={onAddFriends}>Add friends</button>
          </section>
        )
        : (
          <section>
            <h2>{on && onFriends.length > 0 ? 'Free with you' : 'Free now'}</h2>
            {onFriends.length === 0
              ? <p className="note">Nobody’s free right now.</p>
              : <ul className="list">{onFriends.map((f) => <FreeRow key={f.id} friend={f} now={now} onOpen={() => onOpenFriend(f.id)} />)}</ul>}
          </section>
        )}

      {laterFriends.length > 0 && (
        <section>
          <h2>Free later</h2>
          <ul className="list">{laterFriends.map((f) => <FreeRow key={f.id} friend={f} now={now} onOpen={() => onOpenFriend(f.id)} />)}</ul>
        </section>
      )}
    </>
  )
}

function Switch({ state, me, now, onToggle }) {
  const on = state === 'on'
  const detail = on
    ? `Friends can see you’re free. Turns off at ${clock(me.freeUntil)}.`
    : state === 'later'
      ? `Free ${rangeLabel(me.freeFrom, me.freeUntil, now)}. Tap to go on now.`
      : 'Tap to go on for 2 hours.'
  return (
    <button className={on ? 'hero on' : 'hero'} role="switch" aria-checked={on} onClick={() => {
      navigator.vibrate?.(10) // A small buzz where phones allow it (not iPhones).
      onToggle()
    }}>
      <span className="hero-text">
        <strong>{on ? 'I’m on' : 'I’m off'}</strong>
        <span>{detail}</span>
      </span>
      <span className="knob-track" aria-hidden="true"><span className="knob" /></span>
    </button>
  )
}

function TimeControls({ state, me, now, setMine }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [until, setUntil] = useState('')
  const midnight = new Date(now).setHours(24, 0, 0, 0)

  function goFor(untilMs) {
    const at = iso(untilMs)
    setOpen(false)
    setMine(null, at, () => api.setTimes(null, at))
  }

  function showCustom() {
    const active = state !== 'off'
    setFrom(toTimeInput(active ? me.freeFrom ?? now : now))
    setUntil(toTimeInput(active ? me.freeUntil : now + 2 * HOUR))
    setOpen(true)
  }

  function save(e) {
    e.preventDefault()
    const w = resolveWindow(from, until, Date.now())
    setOpen(false)
    setMine(w.from, w.until, () => api.setTimes(w.from, w.until))
  }

  // Once you're on, the useful question is how much longer.
  const extend = (ms) => goFor(new Date(me.freeUntil).getTime() + ms)

  if (open) {
    return (
      <form className="time-form card" onSubmit={save}>
        <label>From<input type="time" value={from} onChange={(e) => setFrom(e.target.value)} required /></label>
        <label>To<input type="time" value={until} onChange={(e) => setUntil(e.target.value)} required /></label>
        <div className="form-actions">
          <button className="primary small">Save</button>
          <button type="button" className="quiet" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </form>
    )
  }
  return (
    <div className="chips" role="group" aria-label="Free for">
      {state === 'on'
        ? (
          <>
            <button className="chip" onClick={() => extend(HOUR / 2)}>+30 min</button>
            <button className="chip" onClick={() => extend(HOUR)}>+1 hr</button>
          </>
        )
        : (
          <>
            <button className="chip" onClick={() => goFor(Date.now() + HOUR)}>1 hr</button>
            <button className="chip" onClick={() => goFor(Date.now() + 2 * HOUR)}>2 hrs</button>
            {midnight - now > 2 * HOUR && <button className="chip" onClick={() => goFor(midnight)}>Till midnight</button>}
          </>
        )}
      <button className="chip" onClick={showCustom}>Custom</button>
      {state === 'later' && (
        <button className="chip" onClick={() => setMine(null, null, () => api.setFree(false))}>Clear</button>
      )}
    </div>
  )
}

function MyNote({ note, run }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  async function saveNote(text) {
    await run(() => api.setNote(text))
    setEditing(false)
  }

  if (editing) {
    return (
      <form className="stack card note-form" onSubmit={(e) => { e.preventDefault(); saveNote(value) }}>
        <div className="chips" role="group" aria-label="Quick notes">
          {NOTE_SHORTCUTS.map((text) => (
            <button key={text} type="button" className="chip" onClick={() => saveNote(text)}>{text}</button>
          ))}
        </div>
        <label>
          <span className="label-row">Your note <span className="muted">{value.length}/60</span></span>
          <input value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} required autoFocus />
        </label>
        <p className="note flush">Friends see this for 24 hours.</p>
        <div className="form-actions">
          <button className="primary small">Save</button>
          <button type="button" className="quiet" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>
    )
  }
  if (!note) {
    return <button className="link" onClick={() => { setValue(''); setEditing(true) }}>Add a note</button>
  }
  return (
    <div className="card my-note">
      <span className="my-note-text">{note}</span>
      <button className="quiet" onClick={() => { setValue(note); setEditing(true) }}>Edit</button>
      <button className="quiet" onClick={() => run(() => api.setNote(''))}>Clear</button>
    </div>
  )
}

function FreeRow({ friend, now, onOpen }) {
  const on = freeState(friend.freeFrom, friend.freeUntil, now) === 'on'
  return (
    <li className={on ? 'row is-on' : 'row'}>
      <button className="row-open" onClick={onOpen}>
        <Avatar person={friend} />
        <span className="person">
          <span className="name">{friend.name}</span>
          <FriendNote friend={friend} now={now} />
          <LastConnection friend={friend} now={now} />
        </span>
        <span className="when">{statusLabel(friend, now)}</span>
      </button>
      <MessageLink friend={friend} />
    </li>
  )
}
