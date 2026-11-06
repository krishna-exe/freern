import * as api from './api'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

export const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent)

function urlBase64ToBytes(base64) {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const pushWorks = () =>
  Boolean(VAPID_PUBLIC_KEY) && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// 'on' | 'off' | 'denied' | 'needs_install' (iPhones only allow it once installed)
// | 'unsupported'
export async function pushStatus() {
  if (isIOS() && !isStandalone()) return 'needs_install'
  if (!pushWorks()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const registration = await navigator.serviceWorker.ready
  return (await registration.pushManager.getSubscription()) ? 'on' : 'off'
}

export async function enablePush() {
  if ((await Notification.requestPermission()) !== 'granted') return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY),
  })
  await api.savePushSubscription(subscription.toJSON())
}

// Also runs at sign out, so a shared phone stops getting this person's alerts.
export async function disablePush() {
  if (!pushWorks()) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  await api.deletePushSubscription(subscription.endpoint)
  await subscription.unsubscribe()
}
