// Drains the notification queue. The database wakes this after queueing rows, and a
// scheduled job wakes it as a backstop. Several copies can run at once safely.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const BATCH_SIZE = 200
const PARALLEL_SENDS = 25
const TIME_BUDGET_MS = 20_000
// A status is stale within the hour, so push services can drop it after that.
const TTL_SECONDS = 3600
const SUBSCRIPTION_GONE = new Set([404, 410])

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } }
type Notification = { id: number; payload: unknown; subscriptions: Subscription[] }

// True unless a device failed in a way that's worth retrying.
async function deliver(notification: Notification, deadEndpoints: string[]) {
  const body = JSON.stringify(notification.payload)
  const results = await Promise.allSettled(
    notification.subscriptions.map((subscription) =>
      webpush.sendNotification(subscription, body, { TTL: TTL_SECONDS })),
  )

  let done = true
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') return
    const status = result.reason?.statusCode
    if (SUBSCRIPTION_GONE.has(status)) deadEndpoints.push(notification.subscriptions[i].endpoint)
    else {
      done = false
      console.error('send failed', status, result.reason?.body ?? result.reason?.message)
    }
  })
  return done
}

async function sendBatch(batch: Notification[]) {
  const sentIds: number[] = []
  const deadEndpoints: string[] = []

  for (let i = 0; i < batch.length; i += PARALLEL_SENDS) {
    const slice = batch.slice(i, i + PARALLEL_SENDS)
    const outcomes = await Promise.all(slice.map((n) => deliver(n, deadEndpoints)))
    slice.forEach((n, j) => { if (outcomes[j]) sentIds.push(n.id) })
  }

  const { error } = await admin.rpc('finish_notifications', { sent_ids: sentIds, dead_endpoints: deadEndpoints })
  if (error) console.error('finish failed', error.message)
  return sentIds.length
}

Deno.serve(async (req) => {
  if (req.headers.get('x-dispatch-secret') !== Deno.env.get('DISPATCH_SECRET')) {
    return new Response('Forbidden', { status: 403 })
  }

  const startedAt = Date.now()
  let sent = 0
  while (Date.now() - startedAt < TIME_BUDGET_MS) {
    const { data: batch, error } = await admin.rpc('claim_notifications', { batch_size: BATCH_SIZE })
    if (error) return new Response(error.message, { status: 500 })
    if (batch.length === 0) break
    sent += await sendBatch(batch)
  }
  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } })
})
