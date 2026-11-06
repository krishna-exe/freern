import { useState } from 'react'
import { Avatar } from '../components/Person'

export function ProfileCard({ me }) {
  return (
    <section className="profile card">
      <div className="share">
        <Avatar person={me} large />
        <div className="share-id">
          <span className="name">{me.name}</span>
          <code>@{me.handle}</code>
        </div>
        <ShareButton handle={me.handle} />
      </div>
    </section>
  )
}

function ShareButton({ handle }) {
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}${window.location.pathname}#/add/${handle}`

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Free RN', text: `Add me on Free RN, my ID is @${handle}`, url: link })
      } catch { /* share sheet dismissed */ }
      return
    }
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy your link', link)
    }
  }

  return <button className="secondary small" onClick={share}>{copied ? 'Link copied' : 'Share link'}</button>
}
