import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && key ? createClient(url, key) : null

// There is no email step: the user ID doubles as the login, stored as a
// synthetic address that never receives mail. Confirmations must be off.
// Supabase rejects domains without DNS, so this is a vercel.app domain the
// owner controls. Changing it breaks existing logins unless auth.users is migrated.
const toEmail = (handle) => `${handle}@crew-calendar-orcin.vercel.app`
export const normalizeHandle = (s) => s.trim().replace(/^@/, '').toLowerCase()
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/

export const signUp = ({ handle, name, password }) =>
  supabase.auth.signUp({ email: toEmail(handle), password, options: { data: { name } } })

export const signIn = ({ handle, password }) =>
  supabase.auth.signInWithPassword({ email: toEmail(handle), password })

export const signOut = () => supabase.auth.signOut()

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

export async function loadAll(myId) {
  const [profiles, statuses, links, planRows, responses] = await Promise.all([
    supabase.from('profiles').select('id, handle, name, avatar'),
    supabase.from('statuses').select('user_id, free_from, free_until, note, note_until'),
    supabase.from('friendships').select('requester, addressee, accepted'),
    supabase.from('plans').select('id, user_id, starts_at, note'),
    supabase.from('plan_responses').select('plan_id, user_id'),
  ])
  const people = new Map(unwrap(profiles).map((p) => [p.id, p]))
  const status = new Map(unwrap(statuses).map((s) => [s.user_id, s]))
  const withStatus = (p) => ({ ...p, freeFrom: status.get(p.id)?.free_from ?? null, freeUntil: status.get(p.id)?.free_until ?? null, note: status.get(p.id)?.note ?? null, noteUntil: status.get(p.id)?.note_until ?? null })

  const friends = [], incoming = [], outgoing = []
  for (const l of unwrap(links)) {
    const person = people.get(l.requester === myId ? l.addressee : l.requester)
    if (!person) continue
    if (l.accepted) friends.push(withStatus(person))
    else (l.requester === myId ? outgoing : incoming).push(person)
  }
  const going = unwrap(responses)
  const plans = unwrap(planRows)
    .filter((p) => people.has(p.user_id))
    .map((p) => {
      const in_ = going.filter((r) => r.plan_id === p.id)
      return {
        id: p.id,
        startsAt: p.starts_at,
        note: p.note,
        host: people.get(p.user_id),
        imIn: in_.some((r) => r.user_id === myId),
        names: in_.map((r) => people.get(r.user_id)?.name).filter(Boolean),
      }
    })
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
  const me = people.get(myId)
  return { me: me && withStatus(me), friends, incoming, outgoing, plans }
}

export const setFree = async (isFree) => unwrap(await supabase.rpc('set_free', { is_free: isFree }))
export const setTimes = async (from, until) => unwrap(await supabase.rpc('set_times', { from_at: from, until_at: until }))
export const createPlan = async (at, note) => unwrap(await supabase.rpc('create_plan', { at, note }))
export const respondPlan = async (plan, going) => unwrap(await supabase.rpc('respond_plan', { plan, going }))
export const deletePlan = async (id) => unwrap(await supabase.from('plans').delete().eq('id', id))
export const setNote = async (body) => unwrap(await supabase.rpc('set_note', { body }))
export const setAvatar = async (id, avatar) => unwrap(await supabase.from('profiles').update({ avatar }).eq('id', id))
export const addFriend = async (handle) => unwrap(await supabase.rpc('add_friend', { friend_handle: handle }))
export const acceptFriend = async (id) => unwrap(await supabase.rpc('accept_friend', { from_user: id }))

// Decline, cancel and unfriend are all the same delete.
export async function removeLink(myId, otherId) {
  unwrap(await supabase.from('friendships').delete()
    .or(`and(requester.eq.${myId},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${myId})`))
}

export function subscribe(onChange) {
  const channel = supabase.channel('freern-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'statuses' }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plans' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_responses' }, onChange)
    // Changes made while the connection was starting or down never arrive, so
    // reload once it's ready, including after a reconnect.
    .on('system', {}, onChange)
    .subscribe((status) => { if (status === 'SUBSCRIBED') onChange() })
  return () => supabase.removeChannel(channel)
}
