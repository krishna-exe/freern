// Shows push notifications and opens the app when one is tapped. It deliberately
// has no fetch handler: the app is always loaded fresh, so nothing can go stale.

const time = (value) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const dateTime = (value) => new Date(value).toLocaleString([], {
  weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
})

// Times arrive raw so each phone shows them in its own timezone.
const MESSAGES = {
  free: (d) => ({ title: `${d.name} is free`, body: `Till ${time(d.until)}` }),
  both_free: (d) => ({ title: `${d.name} is free too`, body: `You’re both free. They’re on till ${time(d.until)}.` }),
  free_later: (d) => ({ title: `${d.name} is free later`, body: `${dateTime(d.from)} – ${time(d.until)}` }),
  plan: (d) => ({ title: `${d.name} posted a plan`, body: [dateTime(d.at), d.note].filter(Boolean).join(' · ') }),
  nudge: (d) => ({ title: `${d.name} asked if you’re free`, body: 'Tap to answer' }),
}

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  const { title, body } = MESSAGES[data.kind]?.(data) ?? { title: 'Free RN', body: '' }
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // A newer notification about the same thing replaces the older one.
    tag: `${data.kind}:${data.actor}`,
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (windows.length) return windows[0].focus()
    return self.clients.openWindow('/')
  })())
})
