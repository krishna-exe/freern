// Exercises sign-up, privacy rules and live updates against a real Supabase.
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node --experimental-websocket tests/access.mjs
// Creates users with random IDs, so only run it against a local stack.
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key } = process.env
const domain = process.env.LOGIN_DOMAIN ?? 'crew-calendar-orcin.vercel.app'
const tag = Math.random().toString(36).slice(2, 8)
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

let failed = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? ` -> ${JSON.stringify(detail)}` : ''}`)
  if (!ok) failed++
}

async function user(name) {
  const c = client()
  const handle = `${name}_${tag}`
  const { data, error } = await c.auth.signUp({
    email: `${handle}@${domain}`, password: 'hunter22', options: { data: { name } },
  })
  if (error) throw new Error(`signup ${handle}: ${error.message}`)
  return { c, handle, id: data.user.id }
}
const rows = async (q) => (await q).data ?? []
const seesProfile = async (a, b) => (await rows(a.c.from('profiles').select('id').eq('id', b.id))).length === 1
const seesStatus = async (a, b) => (await rows(a.c.from('statuses').select('user_id').eq('user_id', b.id))).length === 1
const waitFor = (fn, ms = 8000) => new Promise((resolve) => {
  const start = Date.now()
  const t = setInterval(() => {
    if (fn()) { clearInterval(t); resolve(true) }
    else if (Date.now() - start > ms) { clearInterval(t); resolve(false) }
  }, 100)
})

const [alice, bob, carol] = [await user('alice'), await user('bob'), await user('carol')]

// Sign-up
const dup = await client().auth.signUp({ email: `${alice.handle}@${domain}`, password: 'hunter22' })
check('duplicate user ID rejected', Boolean(dup.error), dup)
const bad = await client().auth.signUp({ email: `no!pe_${tag}@${domain}`, password: 'hunter22' })
check('invalid user ID rejected', Boolean(bad.error), bad.data)
const relog = await client().auth.signInWithPassword({ email: `${alice.handle}@${domain}`, password: 'hunter22' })
check('can sign back in', !relog.error, relog.error)

// Switch
const { data: until } = await alice.c.rpc('set_free', { is_free: true })
const mins = (new Date(until) - Date.now()) / 60000
check('switching on sets about 2 hours', mins > 118 && mins <= 120, until)

// Strangers
check('stranger cannot see profile', !(await seesProfile(bob, alice)))
check('stranger cannot see status', !(await seesStatus(bob, alice)))

// Pending request
check('add_friend unknown handle', (await bob.c.rpc('add_friend', { friend_handle: `ghost_${tag}` })).data === 'not_found')
check('add_friend self', (await bob.c.rpc('add_friend', { friend_handle: bob.handle })).data === 'self')
check('request sent', (await bob.c.rpc('add_friend', { friend_handle: `@${alice.handle.toUpperCase()}` })).data === 'requested')
check('repeat request reported', (await bob.c.rpc('add_friend', { friend_handle: alice.handle })).data === 'already_requested')
check('requester sees name of target', await seesProfile(bob, alice))
check('requester CANNOT see status while pending', !(await seesStatus(bob, alice)))
check('target sees name of requester', await seesProfile(alice, bob))
check('target CANNOT see status while pending', !(await seesStatus(alice, bob)))

// Forcing acceptance
await bob.c.rpc('accept_friend', { from_user: alice.id })
const accepted = async () => (await rows(alice.c.from('friendships').select('accepted').eq('requester', bob.id)))[0]?.accepted
check('requester cannot self-accept via function', (await accepted()) === false)
const up = await bob.c.from('friendships').update({ accepted: true }).eq('addressee', alice.id)
check('requester cannot self-accept via update', Boolean(up.error) && (await accepted()) === false, up)
const ins = await carol.c.from('friendships').insert({ requester: carol.id, addressee: alice.id, accepted: true })
check('cannot insert an accepted friendship', Boolean(ins.error), ins)
const forged = await carol.c.from('friendships').insert({ requester: alice.id, addressee: carol.id, accepted: true })
check('cannot forge a friendship from someone else', Boolean(forged.error), forged)

// Tampering
const st = await bob.c.from('statuses').update({ free_until: '2099-01-01' }).eq('user_id', bob.id)
check('cannot write own status directly', Boolean(st.error), st)
const st2 = await bob.c.from('statuses').update({ free_until: null }).eq('user_id', alice.id)
check('cannot write someone else\'s status', Boolean(st2.error), st2)
const hd = await bob.c.from('profiles').update({ handle: `hijack_${tag}` }).eq('id', bob.id)
check('cannot change handle', Boolean(hd.error), hd)
await bob.c.from('profiles').update({ name: 'Mallory' }).eq('id', alice.id)
check('cannot rename someone else', (await rows(alice.c.from('profiles').select('name').eq('id', alice.id)))[0].name === 'alice')
const nm = await bob.c.from('profiles').update({ name: 'Bobby' }).eq('id', bob.id)
check('can rename self', !nm.error, nm)

// Accepted
await alice.c.rpc('accept_friend', { from_user: bob.id })
check('accepted friend sees status', await seesStatus(bob, alice))
check('friendship is mutual', await seesStatus(alice, bob))
check('third party sees no profile', !(await seesProfile(carol, alice)))
check('third party sees no status', !(await seesStatus(carol, alice)))
check('third party sees no friendship', (await rows(carol.c.from('friendships').select('*').eq('addressee', alice.id))).length === 0)

// Times
const soon = (mins) => new Date(Date.now() + mins * 60000).toISOString()
const status = async (u, of) => (await rows(u.c.from('statuses').select('free_from, free_until').eq('user_id', of.id)))[0]
await bob.c.rpc('set_times', { from_at: soon(60), until_at: soon(120) })
const bobStatus = await status(alice, bob)
check('friend sees a from-to window', Boolean(bobStatus?.free_from) && new Date(bobStatus.free_from) > new Date(), bobStatus)
check('end before start rejected', Boolean((await bob.c.rpc('set_times', { from_at: soon(120), until_at: soon(60) })).error))
check('end in the past rejected', Boolean((await bob.c.rpc('set_times', { from_at: soon(-120), until_at: soon(-60) })).error))
check('far-future status rejected', Boolean((await bob.c.rpc('set_times', { from_at: soon(60), until_at: soon(60 * 24 * 30) })).error))
await bob.c.rpc('set_free', { is_free: true })
const reset = await status(alice, bob)
check('switching on replaces a future window', new Date(reset.free_from) <= new Date(), reset)
await bob.c.rpc('set_free', { is_free: false })
check('switching off clears both times', !(await status(alice, bob)).free_from)

// Plans (alice and bob are friends, carol is a stranger to both here)
const made = await alice.c.rpc('create_plan', { at: soon(60 * 24), note: 'chai' })
const planId = made.data
check('can post a plan', Boolean(planId) && !made.error, made)
check('past plan rejected', Boolean((await alice.c.rpc('create_plan', { at: soon(-5), note: '' })).error))
const longNote = await alice.c.rpc('create_plan', { at: soon(60), note: 'x'.repeat(141) })
check('overlong note rejected', Boolean(longNote.error), longNote)
const seesPlan = async (u) => (await rows(u.c.from('plans').select('id').eq('id', planId))).length === 1
check('host sees plan', await seesPlan(alice))
check('friend sees plan', await seesPlan(bob))
check('stranger CANNOT see plan', !(await seesPlan(carol)))
const direct = await bob.c.from('plans').insert({ user_id: alice.id, starts_at: soon(60) })
check('cannot post a plan as someone else', Boolean(direct.error), direct)
check('stranger cannot join', Boolean((await carol.c.rpc('respond_plan', { plan: planId, going: true })).error))
const forgedIn = await carol.c.from('plan_responses').insert({ plan_id: planId, user_id: carol.id })
check('cannot insert a response directly', Boolean(forgedIn.error), forgedIn)
check('friend can join', !(await bob.c.rpc('respond_plan', { plan: planId, going: true })).error)
const respondents = async (u) => (await rows(u.c.from('plan_responses').select('user_id').eq('plan_id', planId))).map((r) => r.user_id)
check('host sees who joined', (await respondents(alice)).includes(bob.id))
check('stranger cannot see who joined', (await respondents(carol)).length === 0)
await carol.c.from('plans').delete().eq('id', planId)
check('stranger cannot delete plan', await seesPlan(alice))
await bob.c.from('plans').delete().eq('id', planId)
check('friend cannot delete plan', await seesPlan(alice))
check('friend can leave', !(await bob.c.rpc('respond_plan', { plan: planId, going: false })).error)
check('leaving removes response', !(await respondents(alice)).includes(bob.id))

// Crossed requests
check('crossed: first requests', (await carol.c.rpc('add_friend', { friend_handle: alice.handle })).data === 'requested')
check('crossed: second accepts', (await alice.c.rpc('add_friend', { friend_handle: carol.handle })).data === 'accepted')
await carol.c.from('friendships').delete().eq('requester', carol.id)

// Delete scope
await carol.c.from('friendships').delete().eq('requester', bob.id)
check('third party cannot delete a friendship', await seesStatus(bob, alice))

// Signed-out visitors
const anon = client()
check('anon reads no profiles', (await rows(anon.from('profiles').select('id'))).length === 0)
check('anon reads no statuses', (await rows(anon.from('statuses').select('user_id'))).length === 0)
check('anon cannot call add_friend', Boolean((await anon.rpc('add_friend', { friend_handle: alice.handle })).error))
check('anon cannot call set_free', Boolean((await anon.rpc('set_free', { is_free: true })).error))
check('anon cannot call create_plan', Boolean((await anon.rpc('create_plan', { at: soon(60), note: '' })).error))
check('anon reads no plans', (await rows(anon.from('plans').select('id'))).length === 0)

// Realtime (SKIP_REALTIME=1 when the backend has no realtime server)
if (!process.env.SKIP_REALTIME) {
async function listen(u) {
  await u.c.realtime.setAuth((await u.c.auth.getSession()).data.session.access_token)
  const events = []
  await new Promise((resolve, reject) => {
    u.c.channel(`t-${u.handle}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'statuses' }, (p) => events.push(p))
      .subscribe((s, err) => (s === 'SUBSCRIBED' ? resolve() : s.match(/ERROR|TIMED/) && reject(err ?? new Error(s))))
  })
  return events
}
const bobEvents = await listen(bob)
const carolEvents = await listen(carol)
// Subscriptions take a few seconds to go live; toggling sooner would make
// the "gets no update" checks below pass vacuously.
await new Promise((r) => setTimeout(r, 6000))
await alice.c.rpc('set_free', { is_free: false })
check('friend gets a live update', await waitFor(() => bobEvents.some((e) => e.new.user_id === alice.id)), bobEvents)
await new Promise((r) => setTimeout(r, 3000))
check('non-friend gets no live update', !carolEvents.some((e) => e.new.user_id === alice.id), carolEvents)
globalThis.bobEvents = bobEvents
}

// Unfriend
await bob.c.from('friendships').delete().eq('addressee', alice.id)
check('unfriending hides status', !(await seesStatus(bob, alice)))
check('unfriending hides profile', !(await seesProfile(bob, alice)))
check('unfriending hides plans', !(await seesPlan(bob)))
check('ex-friend cannot join plan', Boolean((await bob.c.rpc('respond_plan', { plan: planId, going: true })).error))
await alice.c.from('plans').delete().eq('id', planId)
check('host can delete plan', !(await seesPlan(alice)))
if (globalThis.bobEvents) {
  const events = globalThis.bobEvents
  events.length = 0
  await new Promise((r) => setTimeout(r, 1000))
  await alice.c.rpc('set_free', { is_free: true })
  await new Promise((r) => setTimeout(r, 2000))
  check('ex-friend gets no live update', !events.some((e) => e.new.user_id === alice.id), events)
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
