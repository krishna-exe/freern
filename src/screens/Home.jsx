import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../lib/api'
import { handleFromHash } from '../lib/invite'
import { disablePush } from '../lib/push'
import { PLAN_VISIBLE_AFTER_START_MS } from '../lib/times'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import { useUndo } from '../lib/useUndo'
import { NotifyPrompt } from '../components/NotifyPrompt'
import { RecoveryCode, RecoveryPrompt } from '../components/Recovery'
import { TabBar } from '../components/TabBar'
import { FriendsTab } from './FriendsTab'
import { NowTab } from './NowTab'
import { PlansTab } from './PlansTab'

// Which plans this device has shown, for the badge on the Plans tab.
function readSeenPlans(myId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`freern-seen-plans-${myId}`)) ?? [])
  } catch {
    return new Set()
  }
}
function writeSeenPlans(myId, ids) {
  try {
    localStorage.setItem(`freern-seen-plans-${myId}`, JSON.stringify(ids))
  } catch { /* the badge just won't clear across reloads */ }
}

// One action can ping a phone several times, so wait briefly and reload once.
const REFRESH_DELAY_MS = 300

export function Home({ myId }) {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [invite, setInvite] = useState(handleFromHash)
  const [tab, setTab] = useState(() => (handleFromHash() ? 'friends' : 'now'))
  const [seenPlans, setSeenPlans] = useState(() => readSeenPlans(myId))
  const writes = useRef(0)
  const refreshTimer = useRef(null)
  const [recoveryCode, setRecoveryCode] = useState('')
  const { pending, schedule, undo, flush } = useUndo()

  const refresh = useCallback(async () => {
    const startedAt = writes.current
    try {
      const next = await api.loadHome()
      // A load that began before a write finished would undo the optimistic switch.
      if (startedAt !== writes.current) return
      // Keep the clock current so fresh data isn't judged against a stale time.
      setNow(Date.now())
      setData(next)
      setLoadError('')
    } catch (e) {
      setLoadError(e.message)
    }
  }, [])

  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) return
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      refresh()
    }, REFRESH_DELAY_MS)
  }, [refresh])

  useEffect(() => {
    refresh()
    const unsubscribe = api.subscribe(myId, refreshSoon)
    // Live updates can drop while a phone sleeps, so catch up on return too.
    const onVisible = () => { if (!document.hidden) { setNow(Date.now()); refresh() } }
    document.addEventListener('visibilitychange', onVisible)
    const tick = setInterval(() => setNow(Date.now()), 15000)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(tick)
      clearTimeout(refreshTimer.current)
      refreshTimer.current = null
    }
  }, [myId, refresh, refreshSoon])

  // Opening a friend's link lands on Friends with their ID filled in.
  useEffect(() => {
    function takeInvite() {
      const h = handleFromHash()
      if (!h) return
      setInvite(h)
      setTab('friends')
      history.replaceState(null, '', window.location.pathname)
    }
    takeInvite()
    window.addEventListener('hashchange', takeInvite)
    return () => window.removeEventListener('hashchange', takeInvite)
  }, [])

  const run = useCallback(async (fn) => {
    setActionError('')
    try {
      const result = await fn()
      setNow(Date.now())
      await refresh()
      return result
    } catch (e) {
      setActionError(e.message)
    }
  }, [refresh])

  // The switch changes on screen right away; a failed write restores the real state.
  const setMine = useCallback(async (freeFrom, freeUntil, write) => {
    const before = data.me
    writes.current++
    setActionError('')
    setNow(Date.now())
    setData((d) => ({ ...d, me: { ...d.me, freeFrom, freeUntil } }))
    try {
      await write()
    } catch (e) {
      setActionError(e.message)
      setData((d) => ({ ...d, me: { ...d.me, freeFrom: before.freeFrom, freeUntil: before.freeUntil } }))
    }
    writes.current++
    await refresh()
  }, [data, refresh])

  const { pull, ready, refreshing } = usePullToRefresh(refresh)
  const hiddenId = pending?.hiddenId
  const plans = (data?.plans ?? []).filter(
    (p) => p.id !== hiddenId && new Date(p.startsAt).getTime() + PLAN_VISIBLE_AFTER_START_MS > now)
  const planIds = plans.map((p) => p.id).join()

  useEffect(() => {
    if (tab !== 'plans' || !planIds) return
    const ids = planIds.split(',')
    writeSeenPlans(myId, ids)
    setSeenPlans(new Set(ids))
  }, [tab, planIds, myId])

  function openTab(next) {
    setTab(next)
    setActionError('')
    window.scrollTo(0, 0)
  }

  const error = actionError || loadError
  if (!data) return <main className="page">{error ? <p className="error" role="alert">{error}</p> : <p className="note">Loading…</p>}</main>
  if (!data.me) return <main className="page"><p className="error">Account not found.</p><button className="link" onClick={api.signOut}>Sign out</button></main>

  const newPlans = tab === 'plans' ? 0 : plans.filter((p) => p.host.id !== myId && !p.myAnswer && !seenPlans.has(p.id)).length

  const visible = {
    ...data,
    plans,
    friends: data.friends.filter((f) => f.id !== hiddenId),
    incoming: data.incoming.filter((p) => p.id !== hiddenId),
  }

  const removeFriend = (friend) => schedule({
    message: `Removed ${friend.name}`,
    hiddenId: friend.id,
    apply: () => run(() => api.removeLink(myId, friend.id)),
  })
  const blockPerson = (person) => schedule({
    message: `Blocked ${person.name}`,
    hiddenId: person.id,
    apply: () => run(() => api.blockUser(person.id)),
  })
  const deletePlan = (plan) => schedule({
    message: 'Plan deleted',
    hiddenId: plan.id,
    apply: () => run(() => api.deletePlan(plan.id)),
  })
  const createRecoveryCode = async () => {
    const code = await run(() => api.newRecoveryCode())
    if (code) setRecoveryCode(code)
  }
  const deleteAccount = (handle) => run(async () => {
    await flush()
    await api.deleteAccount(handle)
  })
  const signOut = async () => {
    await flush()
    await disablePush().catch(() => { /* never let this stop someone signing out */ })
    await api.signOut()
  }

  return (
    <>
      {(pull > 0 || refreshing) && (
        <p className="pull-hint" style={{ height: refreshing ? 44 : Math.min(pull, 88) }} role="status">
          {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
        </p>
      )}
      <main className="page">
        {error && <p className="error" role="alert">{error}</p>}
        {recoveryCode && <RecoveryCode code={recoveryCode} onDone={() => setRecoveryCode('')} />}
        {tab === 'now' && <NowTab data={visible} now={now} run={run} setMine={setMine} onAddFriends={() => openTab('friends')} />}
        {tab === 'plans' && <PlansTab plans={plans} groups={data.groups} myId={myId} now={now} run={run} onDelete={deletePlan} />}
        {tab === 'friends' && (
          <FriendsTab data={visible} myId={myId} now={now} run={run}
            invite={invite} onInviteUsed={() => setInvite('')}
            onRemoveFriend={removeFriend} onBlock={blockPerson} onSignOut={signOut}
            onNewRecoveryCode={createRecoveryCode} onDeleteAccount={deleteAccount} />
        )}
        {tab === 'now' && !data.me.hasRecoveryCode && !recoveryCode && <RecoveryPrompt onCreate={createRecoveryCode} />}
        {tab === 'now' && data.friends.length > 0 && <NotifyPrompt />}
      </main>
      {pending && (
        <div className="toast" role="status">
          <span>{pending.message}</span>
          <button onClick={undo}>Undo</button>
        </div>
      )}
      <TabBar tab={tab} badges={{ plans: newPlans, friends: data.incoming.length }} onOpen={openTab} />
    </>
  )
}
