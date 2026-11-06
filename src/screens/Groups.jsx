import { useState } from 'react'
import * as api from '../lib/api'

// Private lists for sending a plan to some friends. Members never see them.
export function Groups({ groups, friends, run }) {
  const [openId, setOpenId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  async function create(e) {
    e.preventDefault()
    const id = await run(() => api.createGroup(name))
    if (id) {
      setName('')
      setCreating(false)
      setOpenId(id)
    }
  }

  return (
    <section>
      <h2>Groups</h2>
      {groups.length > 0 && (
        <ul className="list groups">
          {groups.map((group) => (
            <GroupRow key={group.id} group={group} friends={friends} run={run}
              open={openId === group.id} onToggle={() => setOpenId(openId === group.id ? null : group.id)} />
          ))}
        </ul>
      )}
      {creating
        ? (
          <form className="stack card" onSubmit={create}>
            <label>Group name<input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
            <div className="form-actions">
              <button className="primary small">Create</button>
              <button type="button" className="quiet" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </form>
        )
        : <button className="link" onClick={() => setCreating(true)}>New group</button>}
    </section>
  )
}

function GroupRow({ group, friends, run, open, onToggle }) {
  // Boxes respond right away; `saving` holds the choice until the server has it.
  const [saving, setSaving] = useState({})
  const isMember = (id) => saving[id] ?? group.memberIds.includes(id)
  const count = group.memberIds.length

  async function setMember(friendId, included) {
    setSaving((s) => ({ ...s, [friendId]: included }))
    await run(() => api.setGroupMember(group.id, friendId, included))
    setSaving(({ [friendId]: _done, ...rest }) => rest)
  }

  return (
    <li>
      <button className="row row-button" aria-expanded={open} onClick={onToggle}>
        <span className="name grow">{group.name}</span>
        <span className="when">{count === 1 ? '1 person' : `${count} people`}</span>
      </button>
      {open && (
        <div className="group-editor">
          {friends.map((friend) => (
            <label key={friend.id} className="check">
              <input type="checkbox" checked={isMember(friend.id)} onChange={(e) => setMember(friend.id, e.target.checked)} />
              {friend.name}
            </label>
          ))}
          <button className="danger-link" onClick={() => {
            if (window.confirm(`Delete ${group.name} and any plans sent to it?`)) run(() => api.deleteGroup(group.id))
          }}>Delete group</button>
        </div>
      )}
    </li>
  )
}
