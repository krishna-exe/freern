import { useEffect, useState } from 'react'

// Browsers fire this once, possibly before React has started, so catch it early.
let savedPrompt = null
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  savedPrompt = event
})

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(savedPrompt)

  useEffect(() => {
    const onPrompt = (event) => setPrompt(event)
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  async function install() {
    prompt.prompt()
    await prompt.userChoice
    savedPrompt = null
    setPrompt(null)
  }

  return { canPrompt: Boolean(prompt), install }
}
