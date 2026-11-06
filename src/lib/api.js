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

// Resolves to null on success, or a message to show.
export async function resetPassword({ handle, code, password }) {
  const { data, error } = await supabase.functions.invoke('reset-password', { body: { handle, code, password } })
  if (data?.ok) return null
  const body = await error?.context?.json?.().catch(() => null)
  return data?.error ?? body?.error ?? 'Something went wrong. Try again.'
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// Everything a signed-in screen shows, in one call.
export const loadHome = async () => unwrap(await supabase.rpc('get_home'))

export const setFree = async (isFree) => unwrap(await supabase.rpc('set_free', { is_free: isFree }))
export const setTimes = async (from, until) => unwrap(await supabase.rpc('set_times', { from_at: from, until_at: until }))
export const createPlan = async (at, note, audience) => unwrap(await supabase.rpc('create_plan', { at, note, audience }))
export const answerPlan = async (plan, answer) => unwrap(await supabase.rpc('answer_plan', { plan, answer }))
export const deletePlan = async (id) => unwrap(await supabase.from('plans').delete().eq('id', id))
export const setNote = async (body) => unwrap(await supabase.rpc('set_note', { body }))
export const setName = async (id, name) => unwrap(await supabase.from('profiles').update({ name }).eq('id', id))
export const newRecoveryCode = async () => unwrap(await supabase.rpc('new_recovery_code'))
export const blockUser = async (other) => unwrap(await supabase.rpc('block_user', { other }))
export const unblockUser = async (other) => unwrap(await supabase.rpc('unblock_user', { other }))
export async function deleteAccount(handle) {
  unwrap(await supabase.rpc('delete_account', { confirm_handle: handle }))
  // The account is gone, so there's no session left on the server to end.
  await supabase.auth.signOut({ scope: 'local' })
}
export const setDetails = async (whatsapp, usually) => unwrap(await supabase.rpc('set_details', { whatsapp_number: whatsapp, usually_free: usually }))
export const createGroup = async (name) => unwrap(await supabase.rpc('create_group', { group_name: name }))
export const deleteGroup = async (target) => unwrap(await supabase.rpc('delete_group', { target }))
export const setGroupMember = async (target, friend, included) => unwrap(await supabase.rpc('set_group_member', { target, friend, included }))
export const savePushSubscription = async ({ endpoint, keys }) => unwrap(await supabase.rpc('save_push_subscription', { sub_endpoint: endpoint, sub_p256dh: keys.p256dh, sub_auth: keys.auth }))
export const deletePushSubscription = async (endpoint) => unwrap(await supabase.rpc('delete_push_subscription', { sub_endpoint: endpoint }))
export const setFriendNotify = async (friend, enabled) => unwrap(await supabase.rpc('set_friend_notify', { friend, enabled }))
export const nudge = async (friend) => unwrap(await supabase.rpc('nudge', { friend }))
export const dismissNudge = async (fromUser) => unwrap(await supabase.rpc('dismiss_nudge', { from_user: fromUser }))
export const setAvatar = async (id, avatar) => unwrap(await supabase.from('profiles').update({ avatar }).eq('id', id))
export const addFriend = async (handle) => unwrap(await supabase.rpc('add_friend', { friend_handle: handle }))
export const acceptFriend = async (id) => unwrap(await supabase.rpc('accept_friend', { from_user: id }))

// Decline, cancel and unfriend are all the same delete.
export async function removeLink(myId, otherId) {
  unwrap(await supabase.from('friendships').delete()
    .or(`and(requester.eq.${myId},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${myId})`))
}

// The server pings this topic whenever something you can see changes. The
// message has no data in it, so `onChange` reloads through get_home.
export function subscribe(myId, onChange) {
  let stopped = false
  const channel = supabase
    .channel(`user:${myId}`, { config: { private: true } })
    .on('broadcast', { event: 'changed' }, onChange)

  supabase.realtime.setAuth().then(() => {
    if (stopped) return
    // Changes made while connecting or disconnected never arrive, so catch up
    // each time the connection comes up.
    channel.subscribe((status) => { if (status === 'SUBSCRIBED') onChange() })
  })

  return () => {
    stopped = true
    supabase.removeChannel(channel)
  }
}

export const whatsappLink = (number) =>
  `https://wa.me/${number}?text=${encodeURIComponent('Hey, saw you’re free on Free RN')}`
