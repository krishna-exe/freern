// The number on the installed app's icon. Not every phone supports it, and it
// only updates while the app is open.
export function setAppBadge(count) {
  if (!('setAppBadge' in navigator)) return
  const change = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()
  change.catch(() => { /* just a nicety, so never worth an error */ })
}
