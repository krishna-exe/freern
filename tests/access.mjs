// Exercises sign-up, privacy rules and live updates against a real Supabase.
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node --experimental-websocket tests/access.mjs
// Creates users with random IDs. Remove them afterwards with scripts/clean_test_users.py.
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
check('switching on sets about 2 hours', mins > 118 && mins <= 121, until)

// Strangers
check('stranger cannot see profile', !(await seesProfile(bob, alice)))
check('stranger cannot see status', !(await seesStatus(bob, alice)))

// Pending request
check('add_friend unknown handle', (await bob.c.rpc('add_friend', { friend_handle: `ghost_${tag}` })).data === 'not_found')
check('add_friend self', (await bob.c.rpc('add_friend', { friend_handle: bob.handle })).data === 'self')
check('request sent', (await bob.c.rpc('add_friend', { friend_handle: `@${alice.handle.toUpperCase()}` })).data === 'requested')
check('repeat request reported', (await bob.c.rpc('add_friend', { friend_handle: alice.handle })).data === 'already_requested')
check('requester sees name of target', await seesProfile(bob, alice))
const home = async (u) => (await u.c.rpc('get_home')).data
const pendingHome = await home(bob)
check('home: pending request is listed', pendingHome.outgoing.some((p) => p.id === alice.id), pendingHome)
check('home: pending request has no status', !JSON.stringify(pendingHome.outgoing).includes('freeUntil'), pendingHome.outgoing)
check('home: pending request is not a friend', pendingHome.friends.length === 0, pendingHome.friends)
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

// Home
const friendHome = await home(alice)
check('home: friend is listed with status', friendHome.friends.some((f) => f.id === bob.id && 'freeUntil' in f), friendHome.friends)
check('home: my own status is included', 'freeUntil' in friendHome.me, friendHome.me)
check('home: stranger sees none of it', !JSON.stringify(await home(carol)).includes(alice.id))
check('home: signed-out visitors are refused', Boolean((await client().rpc('get_home')).error))

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
check('switching on leaves no start time', reset.free_from === null && new Date(reset.free_until) > new Date(), reset)
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
check('home: friend sees plan', (await home(bob)).plans.some((p) => p.id === planId))
check('home: stranger does not see plan', !(await home(carol)).plans.some((p) => p.id === planId))
const direct = await bob.c.from('plans').insert({ user_id: alice.id, starts_at: soon(60) })
check('cannot post a plan as someone else', Boolean(direct.error), direct)
check('stranger cannot answer', Boolean((await carol.c.rpc('answer_plan', { plan: planId, answer: 'in' })).error))
const forgedIn = await carol.c.from('plan_responses').insert({ plan_id: planId, user_id: carol.id })
check('cannot insert a response directly', Boolean(forgedIn.error), forgedIn)
check('unknown answer rejected', Boolean((await bob.c.rpc('answer_plan', { plan: planId, answer: 'maybe' })).error))
check('friend can join', !(await bob.c.rpc('answer_plan', { plan: planId, answer: 'in' })).error)
const respondents = async (u) => (await rows(u.c.from('plan_responses').select('user_id').eq('plan_id', planId))).map((r) => r.user_id)
check('host sees who joined', (await respondents(alice)).includes(bob.id))
check('stranger cannot see who joined', (await respondents(carol)).length === 0)
await carol.c.from('plans').delete().eq('id', planId)
check('stranger cannot delete plan', await seesPlan(alice))
await bob.c.from('plans').delete().eq('id', planId)
check('friend cannot delete plan', await seesPlan(alice))
const planIn = async (u) => (await home(u)).plans.find((p) => p.id === planId)
check('home: host sees who is in', (await planIn(alice)).inNames.includes('Bobby'), await planIn(alice))
check('home: host sees their faces', (await planIn(alice)).inPeople.some((p) => p.id === bob.id), await planIn(alice))
check('friend can say they can\'t', !(await bob.c.rpc('answer_plan', { plan: planId, answer: 'out' })).error)
const afterOut = await planIn(alice)
check('home: host sees who can\'t', afterOut.outNames.includes('Bobby') && afterOut.inNames.length === 0, afterOut)
check('home: friend sees their own answer', (await planIn(bob)).myAnswer === 'out')
check('friend can take back their answer', !(await bob.c.rpc('answer_plan', { plan: planId, answer: null })).error)
check('taking it back removes response', !(await respondents(alice)).includes(bob.id))

// Notes
const noteOf = async (u, of) => (await rows(u.c.from('statuses').select('note, note_until').eq('user_id', of.id)))[0]
check('can set a note', !(await bob.c.rpc('set_note', { body: '  down for chai  ' })).error)
const seen = await noteOf(alice, bob)
check('friend sees the note, trimmed', seen?.note === 'down for chai', seen)
const noteHours = (new Date(seen?.note_until) - Date.now()) / 3600000
check('note lasts about 24 hours', noteHours > 23.9 && noteHours <= 24.02, seen)
check('stranger cannot see the note', !(await noteOf(carol, bob)))
check('note over 60 characters rejected', Boolean((await bob.c.rpc('set_note', { body: 'x'.repeat(61) })).error))
const forgedNote = await bob.c.from('statuses').update({ note: 'hi', note_until: '2099-01-01' }).eq('user_id', bob.id)
check('cannot write a note directly', Boolean(forgedNote.error), forgedNote)
await bob.c.rpc('set_free', { is_free: false })
check('switching off keeps the note', (await noteOf(alice, bob)).note === 'down for chai')
await bob.c.rpc('set_note', { body: '' })
const cleared = await noteOf(alice, bob)
check('clearing removes the note', cleared.note === null && cleared.note_until === null, cleared)
check('anon cannot set a note', Boolean((await client().rpc('set_note', { body: 'x' })).error))

// Pictures
check('can pick a picture', !(await bob.c.from('profiles').update({ avatar: '🦊' }).eq('id', bob.id)).error)
const pic = async (u, of) => (await rows(u.c.from('profiles').select('avatar').eq('id', of.id)))[0]?.avatar
check('friend sees the picture', (await pic(alice, bob)) === '🦊')
check('picture outside the set rejected', Boolean((await bob.c.from('profiles').update({ avatar: 'https://evil.example/x.png' }).eq('id', bob.id)).error))
await bob.c.from('profiles').update({ avatar: '🐼' }).eq('id', alice.id)
check('cannot change someone else\'s picture', (await pic(alice, alice)) === null)
check('can go back to initials', !(await bob.c.from('profiles').update({ avatar: null }).eq('id', bob.id)).error)

// Catching up (alice and bob are friends, carol is a stranger)
const logged = await alice.c.rpc('log_connection', { friend_id: bob.id, how: 'talked' })
check('can log with a friend', Boolean(logged.data) && !logged.error, logged)
const lastFor = async (u, other) => (await home(u)).friends.find((f) => f.id === other.id)?.lastConnection
check('both friends see it', (await lastFor(alice, bob))?.kind === 'talked' && (await lastFor(bob, alice))?.kind === 'talked')
const sameCall = await bob.c.rpc('log_connection', { friend_id: alice.id, how: 'talked' })
check('both logging the same call counts once', sameCall.data === logged.data, sameCall)
await bob.c.rpc('log_connection', { friend_id: alice.id, how: 'texted' })
check('the newest entry shows', (await lastFor(alice, bob))?.kind === 'texted')
const historyFor = async (u, other) => (await u.c.rpc('get_connections', { friend_id: other.id })).data
check('history lists both, newest first', (await historyFor(alice, bob)).map((e) => e.kind).join() === 'texted,talked', await historyFor(alice, bob))
check('history marks which are yours', (await historyFor(alice, bob))[1].mine === true && (await historyFor(alice, bob))[0].mine === false)
check('unknown kind rejected', Boolean((await alice.c.rpc('log_connection', { friend_id: bob.id, how: 'sang' })).error))
check('cannot log with a stranger', Boolean((await carol.c.rpc('log_connection', { friend_id: alice.id, how: 'talked' })).error))
check('cannot log with yourself', Boolean((await alice.c.rpc('log_connection', { friend_id: alice.id, how: 'talked' })).error))
check('stranger cannot read the history', (await historyFor(carol, alice)).length === 0)
const readLog = await carol.c.from('connections').select('*')
check('log table cannot be read', Boolean(readLog.error) || readLog.data.length === 0, readLog)
const forgedLog = await carol.c.from('connections').insert({ logged_by: alice.id, friend: bob.id, kind: 'talked' })
check('log table cannot be written', Boolean(forgedLog.error), forgedLog)
await alice.c.rpc('delete_connection', { target: (await historyFor(alice, bob))[0].id })
check('cannot remove the other person\'s entry', (await historyFor(alice, bob)).length === 2)
await alice.c.rpc('delete_connection', { target: logged.data })
check('can remove your own entry', (await historyFor(alice, bob)).length === 1)
check('signed-out visitors cannot log', Boolean((await client().rpc('log_connection', { friend_id: bob.id, how: 'talked' })).error))

// WhatsApp and usual times (bob is alice's friend, carol is a stranger)
check('bad number rejected', Boolean((await bob.c.rpc('set_details', { whatsapp_number: '12', usually_free: '' })).error))
check('long hint rejected', Boolean((await bob.c.rpc('set_details', { whatsapp_number: '', usually_free: 'x'.repeat(41) })).error))
check('can save details, tidied', !(await bob.c.rpc('set_details', { whatsapp_number: '+91 98765-43210', usually_free: ' weekdays after 9 PM ' })).error)
const bobInAlice = (await home(alice)).friends.find((f) => f.id === bob.id)
check('friend sees number and hint', bobInAlice.whatsapp === '919876543210' && bobInAlice.usually === 'weekdays after 9 PM', bobInAlice)
check('stranger never sees the number', !JSON.stringify(await home(carol)).includes('919876543210'))
const carolAsks = await carol.c.rpc('add_friend', { friend_handle: bob.handle })
check('pending request never sees the number', carolAsks.data === 'requested' && !JSON.stringify(await home(carol)).includes('919876543210') && !JSON.stringify(await home(bob)).includes('undefined'))
await carol.c.from('friendships').delete().eq('requester', carol.id)
const directDetails = await carol.c.schema('private').from('friend_details').select('*')
check('details table cannot be read directly', Boolean(directDetails.error), directDetails)
await bob.c.rpc('set_details', { whatsapp_number: '', usually_free: '' })
check('details can be cleared', (await home(alice)).friends.find((f) => f.id === bob.id).whatsapp === null)

// Groups (alice is friends with bob; erin is a friend outside the group)
const erin = await user('erin')
await erin.c.rpc('add_friend', { friend_handle: alice.handle })
await alice.c.rpc('accept_friend', { from_user: erin.id })
const groupId = (await alice.c.rpc('create_group', { group_name: 'College' })).data
check('can make a group', Boolean(groupId))
check('group owner sees it', (await home(alice)).groups.some((g) => g.id === groupId))
check('others never see it', (await home(bob)).groups.length === 0 && !JSON.stringify(await home(bob)).includes('College'))
const readGroups = await bob.c.from('groups').select('*')
check('groups table cannot be read', Boolean(readGroups.error) || readGroups.data.length === 0, readGroups)
check('only friends can be added', Boolean((await alice.c.rpc('set_group_member', { target: groupId, friend: carol.id, included: true })).error))
check('cannot edit someone else\'s group', Boolean((await bob.c.rpc('set_group_member', { target: groupId, friend: bob.id, included: true })).error))
check('can add a friend', !(await alice.c.rpc('set_group_member', { target: groupId, friend: bob.id, included: true })).error)
const groupPlan = (await alice.c.rpc('create_plan', { at: soon(600), note: 'group only', audience: groupId })).data
check('cannot post to someone else\'s group', Boolean((await bob.c.rpc('create_plan', { at: soon(600), note: 'x', audience: groupId })).error))
const planFor = async (u) => (await home(u)).plans.find((p) => p.id === groupPlan)
check('host sees group plan, with the name', (await planFor(alice))?.groupName === 'College', await planFor(alice))
check('member sees group plan, without the name', Boolean(await planFor(bob)) && (await planFor(bob)).groupName === null, await planFor(bob))
check('friend outside the group does NOT see it', !(await planFor(erin)))
const erinReads = await erin.c.from('plans').select('id').eq('id', groupPlan)
check('friend outside the group cannot read it directly', (erinReads.data ?? []).length === 0, erinReads)
check('friend outside the group cannot answer', Boolean((await erin.c.rpc('answer_plan', { plan: groupPlan, answer: 'in' })).error))
check('member can answer', !(await bob.c.rpc('answer_plan', { plan: groupPlan, answer: 'in' })).error)
await alice.c.rpc('set_group_member', { target: groupId, friend: bob.id, included: false })
check('removed member loses the plan', !(await planFor(bob)))
await alice.c.rpc('delete_group', { target: groupId })
const orphan = await alice.c.from('plans').select('id').eq('id', groupPlan)
check('deleting a group deletes its plans, never widens them', (orphan.data ?? []).length === 0, orphan)
await erin.c.rpc('delete_account', { confirm_handle: erin.handle })

// Blocking (dave blocks and is blocked; alice and bob are unaffected)
const dave = await user('dave')
check('request sent before block', (await dave.c.rpc('add_friend', { friend_handle: alice.handle })).data === 'requested')
check('can block a requester', !(await alice.c.rpc('block_user', { other: dave.id })).error)
check('block removes the request', (await home(alice)).incoming.every((p) => p.id !== dave.id))
check('blocked person is listed for the blocker', (await home(alice)).blocked.some((p) => p.id === dave.id))
check('blocked person cannot request again, and can\'t tell why', (await dave.c.rpc('add_friend', { friend_handle: alice.handle })).data === 'not_found')
check('blocker is told to unblock first', (await alice.c.rpc('add_friend', { friend_handle: dave.handle })).data === 'you_blocked')
const readBlocks = await dave.c.from('blocks').select('*')
check('blocks table cannot be read', Boolean(readBlocks.error) || readBlocks.data.length === 0, readBlocks)
const writeBlock = await dave.c.from('blocks').insert({ blocker: dave.id, blocked: alice.id })
check('blocks table cannot be written', Boolean(writeBlock.error), writeBlock)
check('can unblock', !(await alice.c.rpc('unblock_user', { other: dave.id })).error)
check('after unblocking, requests work again', (await dave.c.rpc('add_friend', { friend_handle: alice.handle })).data === 'requested')

// Deleting an account
const wrongConfirm = await dave.c.rpc('delete_account', { confirm_handle: alice.handle })
check('deleting needs your own ID', Boolean(wrongConfirm.error), wrongConfirm)
check('cannot delete by someone else\'s ID', await seesProfile(alice, dave))
check('deleting works', !(await dave.c.rpc('delete_account', { confirm_handle: dave.handle })).error)
check('deleted person disappears for others', (await home(alice)).incoming.every((p) => p.id !== dave.id))
const relogDeleted = await client().auth.signInWithPassword({ email: `${dave.handle}@${domain}`, password: 'hunter22' })
check('deleted account cannot sign in', Boolean(relogDeleted.error))
check('signed-out visitors cannot delete', Boolean((await client().rpc('delete_account', { confirm_handle: alice.handle })).error))

// Recovery codes
check('home: no recovery code to begin with', (await home(alice)).me.hasRecoveryCode === false)
const newCode = await alice.c.rpc('new_recovery_code')
check('can make a recovery code', /^([0-9A-F]{5}-){3}[0-9A-F]{5}$/.test(newCode.data), newCode)
check('home: code is noted', (await home(alice)).me.hasRecoveryCode === true)
check('signed-out visitors cannot make codes', Boolean((await client().rpc('new_recovery_code')).error))
check('users cannot check codes directly', Boolean((await bob.c.rpc('check_recovery_code', { user_handle: alice.handle, code: newCode.data })).error))
check('visitors cannot check codes directly', Boolean((await client().rpc('check_recovery_code', { user_handle: alice.handle, code: newCode.data })).error))
check('users cannot burn someone\'s code', Boolean((await bob.c.rpc('use_recovery_code', { account: alice.id })).error))
if (!process.env.SKIP_FUNCTIONS) {
  const reset = async (body) => {
    const response = await fetch(`${url}/functions/v1/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` }, body: JSON.stringify(body),
    })
    return response.json()
  }
  check('reset: wrong code refused', !(await reset({ handle: alice.handle, code: 'NOPE', password: 'newpass1' })).ok)
  check('reset: unknown ID gets the same answer', (await reset({ handle: `ghost_${tag}`, code: 'NOPE', password: 'newpass1' })).error === (await reset({ handle: bob.handle, code: 'NOPE', password: 'newpass1' })).error)
  check('reset: short password refused', !(await reset({ handle: alice.handle, code: newCode.data, password: 'x' })).ok)
  const resetOk = await reset({ handle: alice.handle.toUpperCase(), code: newCode.data.toLowerCase().replaceAll('-', ' '), password: 'hunter23' })
  check('reset: right code works, however it is typed', resetOk.ok === true, resetOk)
  const withNew = await client().auth.signInWithPassword({ email: `${alice.handle}@${domain}`, password: 'hunter23' })
  check('reset: new password signs in', !withNew.error, withNew.error)
  const withOld = await client().auth.signInWithPassword({ email: `${alice.handle}@${domain}`, password: 'hunter22' })
  check('reset: old password no longer works', Boolean(withOld.error))
  check('reset: code only works once', !(await reset({ handle: alice.handle, code: newCode.data, password: 'hunter24' })).ok)
  const carolCode = (await carol.c.rpc('new_recovery_code')).data
  for (let i = 0; i < 5; i++) await reset({ handle: carol.handle, code: 'WRONG', password: 'newpass1' })
  check('reset: guesses are limited, even with the right code next', !(await reset({ handle: carol.handle, code: carolCode, password: 'newpass1' })).ok)
}

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

// Realtime (SKIP_REALTIME=1 when the backend has no realtime server, and
// SKIP_FUNCTIONS=1 when it has no edge functions)
if (!process.env.SKIP_REALTIME) {
async function listen(u, owner = u) {
  await u.c.realtime.setAuth((await u.c.auth.getSession()).data.session.access_token)
  const events = []
  const status = await new Promise((resolve) => {
    u.c.channel(`user:${owner.id}`, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, (p) => events.push(p))
      .subscribe((s) => { if (s === 'SUBSCRIBED' || /ERROR|TIMED/.test(s)) resolve(s) })
  })
  return { events, status }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const bobLive = await listen(bob)
const carolLive = await listen(carol)
check('can join your own live topic', bobLive.status === 'SUBSCRIBED', bobLive.status)
const spy = await listen(carol, bob)
check('cannot join someone else\'s live topic', spy.status !== 'SUBSCRIBED', spy.status)
await wait(3000)
await alice.c.rpc('set_free', { is_free: false })
check('friend gets a live update', await waitFor(() => bobLive.events.length > 0), bobLive.events)
await wait(2000)
check('non-friend gets no live update', carolLive.events.length === 0, carolLive.events)
globalThis.bobEvents = bobLive.events
}

// Unfriend
await bob.c.from('friendships').delete().eq('addressee', alice.id)
check('unfriending hides status', !(await seesStatus(bob, alice)))
check('unfriending hides profile', !(await seesProfile(bob, alice)))
check('unfriending hides plans', !(await seesPlan(bob)))
check('ex-friend cannot answer plan', Boolean((await bob.c.rpc('answer_plan', { plan: planId, answer: 'in' })).error))
await alice.c.from('plans').delete().eq('id', planId)
check('host can delete plan', !(await seesPlan(alice)))
if (globalThis.bobEvents) {
  const events = globalThis.bobEvents
  await new Promise((r) => setTimeout(r, 2000))
  events.length = 0
  await alice.c.rpc('set_free', { is_free: true })
  await new Promise((r) => setTimeout(r, 2000))
  check('ex-friend gets no live update', events.length === 0, events)
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
