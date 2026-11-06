import { useState } from 'react'
import * as api from '../lib/api'
import { dateParts, dayTimeLabel, planShortcuts, toDateTimeInput } from '../lib/times'
import { Faces } from '../components/Person'

export function PlansTab({ plans, groups, myId, now, run, onDelete }) {
  const [creating, setCreating] = useState(false)
  const [at, setAt] = useState('')
  const [note, setNote] = useState('')
  const [audience, setAudience] = useState('')

  async function post(e) {
    e.preventDefault()
    const done = await run(async () => {
      await api.createPlan(new Date(at).toISOString(), note.trim(), audience || null)
      return true
    })
    if (done) { setAt(''); setNote(''); setAudience(''); setCreating(false) }
  }

  return (
    <>
      <header className="tab-header">
        <h1>Plans</h1>
        {!creating && <button className="primary small" onClick={() => setCreating(true)}>New plan</button>}
      </header>

      {creating && (
        <form className="stack card" onSubmit={post}>
          <div className="chips" role="group" aria-label="Quick dates">
            {planShortcuts(now).map(({ label, at: shortcut }) => (
              <button key={label} type="button" className="chip" aria-pressed={at === toDateTimeInput(shortcut)}
                onClick={() => setAt(toDateTimeInput(shortcut))}>{label}</button>
            ))}
          </div>
          <label>When<input type="datetime-local" value={at} min={toDateTimeInput(now)} onChange={(e) => setAt(e.target.value)} required /></label>
          <label>What for (optional)<input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} /></label>
          {groups.length > 0 && (
            <label>Who’s it for
              <select value={audience} onChange={(e) => setAudience(e.target.value)}>
                <option value="">All friends</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          )}
          {!audience && <p className="note flush">All your friends will see this.</p>}
          <div className="form-actions">
            <button className="primary small">Post plan</button>
            <button type="button" className="quiet" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      )}

      {plans.length === 0 && !creating && (
        <section className="empty">
          <p className="empty-title">No plans yet</p>
          <p className="note">Pick a day and time, and see which friends are in.</p>
        </section>
      )}

      {plans.length > 0 && (
        <ul className="plans">
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} mine={p.host.id === myId} now={now} run={run} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </>
  )
}

function PlanCard({ plan, mine, now, run, onDelete }) {
  const started = new Date(plan.startsAt).getTime() <= now
  const answer = (next) => run(() => api.answerPlan(plan.id, plan.myAnswer === next ? null : next))
  const { day, month } = dateParts(plan.startsAt)

  return (
    <li className="card plan">
      <span className="date-block" aria-hidden="true">
        <span className="date-day">{day}</span>
        <span className="date-month">{month}</span>
      </span>
      <div className="plan-text">
        <span className="plan-when">
          {started ? <span className="happening">Happening now</span> : dayTimeLabel(plan.startsAt, now)}
        </span>
        {plan.note && <span className="plan-note">{plan.note}</span>}
        <span className="muted">{mine ? `Your plan${plan.groupName ? ` · ${plan.groupName}` : ''}` : plan.host.name}</span>
        {plan.inPeople.length > 0
          ? <Faces people={plan.inPeople} label={`In: ${plan.inNames.join(', ')}`} />
          : <span className="muted">Nobody’s in yet</span>}
        {plan.outNames.length > 0 && <span className="muted">Can’t: {plan.outNames.join(', ')}</span>}
      </div>
      {mine
        ? <button className="quiet plan-delete" onClick={() => onDelete(plan)}>Delete</button>
        : (
          <div className="plan-actions">
            <button className="answer" aria-pressed={plan.myAnswer === 'in'} onClick={() => answer('in')}>I’m in</button>
            <button className="answer" aria-pressed={plan.myAnswer === 'out'} onClick={() => answer('out')}>Can’t make it</button>
          </div>
        )}
    </li>
  )
}
