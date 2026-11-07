import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api'
import { CONNECTION_KINDS, connectionLabel, isDrifting, kindLabel } from '../lib/connections'
import { freeState, whenLabel } from '../lib/times'
import { Avatar, FriendNote, MessageLink, statusLabel } from '../components/Person'

export function FriendPage({ friend, now, run, onBack, onRemove, onBlock }) {
  const [history, setHistory] = useState(null)
  const [message, setMessage] = useState('')
  // What was just tapped, shown straight away while the save happens.
  const [saving, setSaving] = useState(null)
  const state = freeState(friend.freeFrom, friend.freeUntil, now)
  const last = saving ?? friend.lastConnection

  const loadHistory = useCallback(async () => {
    setHistory(await api.getConnections(friend.id))
  }, [friend.id])

  // Also reloads when the friend logs something, since that changes the latest entry.
  const latestAt = friend.lastConnection?.at
  useEffect(() => { loadHistory().catch(() => setHistory([])) }, [loadHistory, latestAt])

  async function log(kind) {
    navigator.vibrate?.(10)
    setSaving({ kind, at: new Date(now).toISOString() })
    await run(() => api.logConnection(friend.id, kind))
    await loadHistory()
    setSaving(null)
  }

  async function removeEntry(id) {
    await run(() => api.deleteConnection(id))
    await loadHistory()
  }

  async function askIfFree() {
    const result = await run(() => api.nudge(friend.id))
    if (result) setMessage(result === 'sent' ? `Asked ${friend.name} if they’re free.` : `You already asked ${friend.name} recently.`)
  }

  return (
    <>
      <header className="tab-header">
        <h1 className="grow friend-title">{friend.name}</h1>
        <button className="quiet" onClick={onBack}>Done</button>
      </header>

      <section className={state === 'on' ? 'card friend-card is-on' : 'card friend-card'}>
        <Avatar person={friend} large />
        <div className="person">
          <span className="handle">@{friend.handle}</span>
          {state !== 'off' && <span className="when-line">Free {statusLabel(friend, now)}</span>}
          <FriendNote friend={friend} now={now} />
          {friend.usually && <span className="handle wrap">Usually {friend.usually}</span>}
        </div>
      </section>

      <section className="card stack">
        <div>
          <p className="empty-title">Caught up?</p>
          <p className={last && isDrifting(last, now) ? 'note flush drifting' : 'note flush'} role="status">
            {last ? connectionLabel(last, now) : 'Nothing logged yet. You’ll both see what you log here.'}
          </p>
        </div>
        <div className="log-buttons">
          {CONNECTION_KINDS.map(({ id, label }) => (
            <button key={id} className="secondary small" onClick={() => log(id)}>{label}</button>
          ))}
        </div>
      </section>

      <div className="friend-actions">
        <MessageLink friend={friend} withLabel />
        {state === 'off' && <button className="text-action" onClick={askIfFree}>You free?</button>}
        <label className="check notify-toggle">
          <input type="checkbox" defaultChecked={!friend.muted}
            onChange={(e) => run(() => api.setFriendNotify(friend.id, e.target.checked))} />
          Notify me
        </label>
      </div>
      {message && <p className="note flush" role="status">{message}</p>}

      {history?.length > 0 && (
        <section>
          <h2>History</h2>
          <ul className="list history">
            {history.map((entry) => (
              <li key={entry.id} className="row">
                <span className="grow">
                  <span className="name">{kindLabel(entry.kind)}</span>
                  <span className="handle history-when">{whenLabel(entry.at, now)}</span>
                </span>
                {entry.mine && (
                  <button className="quiet" aria-label={`Remove ${kindLabel(entry.kind)} entry`} onClick={() => removeEntry(entry.id)}>Remove</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="friend-danger">
        <button className="danger-link" aria-label={`Remove ${friend.name}`} onClick={onRemove}>Remove friend</button>
        <button className="danger-link" aria-label={`Block ${friend.name}`} onClick={onBlock}>Block</button>
      </div>
    </>
  )
}
