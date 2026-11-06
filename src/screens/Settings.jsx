import { useState } from 'react'
import * as api from '../lib/api'
import { AVATARS } from '../lib/avatars'
import { isIOS, isStandalone } from '../lib/push'
import { useInstallPrompt } from '../lib/useInstallPrompt'
import { usePush } from '../lib/usePush'
import { Avatar, Person } from '../components/Person'
import { ProfileCard } from './Profile'

export function Settings({ me, blocked, run, onBack, onNewRecoveryCode, onDeleteAccount, onSignOut }) {
  const [panel, setPanel] = useState(null)
  const close = () => setPanel(null)
  const row = (name) => ({ open: panel === name, onToggle: () => setPanel(panel === name ? null : name) })

  return (
    <>
      <header className="tab-header">
        <h1>Settings</h1>
        <button className="quiet" onClick={onBack}>Done</button>
      </header>

      <ProfileCard me={me} />

      <ul className="list settings">
        <SettingsRow label="Notifications" {...row('notifications')}>
          <NotificationSettings />
        </SettingsRow>
        {!isStandalone() && (
          <SettingsRow label="Install app" {...row('install')}>
            <InstallHelp />
          </SettingsRow>
        )}
        <SettingsRow label="Change picture" {...row('picture')}>
          <AvatarPicker current={me.avatar} onPick={(avatar) => {
            close()
            run(() => api.setAvatar(me.id, avatar))
          }} />
        </SettingsRow>
        <SettingsRow label="Edit name" {...row('name')}>
          <NameForm current={me.name} onCancel={close} onSave={async (name) => {
            await run(() => api.setName(me.id, name))
            close()
          }} />
        </SettingsRow>
        <SettingsRow label="WhatsApp & free times" {...row('details')}>
          <DetailsForm me={me} onCancel={close} onSave={async (whatsapp, usually) => {
            const saved = await run(async () => {
              await api.setDetails(whatsapp, usually)
              return true
            })
            if (saved) close()
          }} />
        </SettingsRow>
        <li><button className="row row-button" onClick={onNewRecoveryCode}>New recovery code</button></li>
        <li><button className="row row-button" onClick={onSignOut}>Sign out</button></li>
        <SettingsRow label="Delete account" danger {...row('delete')}>
          <DeleteForm handle={me.handle} onDelete={onDeleteAccount} />
        </SettingsRow>
      </ul>

      {blocked.length > 0 && (
        <section>
          <h2>Blocked</h2>
          <ul className="list">
            {blocked.map((p) => (
              <li key={p.id} className="row">
                <Avatar person={p} />
                <Person person={p} />
                <button className="quiet" aria-label={`Unblock ${p.name}`} onClick={() => run(() => api.unblockUser(p.id))}>Unblock</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function SettingsRow({ label, danger, open, onToggle, children }) {
  return (
    <li>
      <button className={danger ? 'row row-button danger-text' : 'row row-button'} aria-expanded={open} onClick={onToggle}>
        <span className="grow">{label}</span>
        <span className="chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="settings-panel">{children}</div>}
    </li>
  )
}

const PUSH_HELP = {
  loading: '',
  needs_install: 'On iPhone, notifications only work once the app is on your home screen. Install it below, then open it from there.',
  denied: 'Notifications are blocked for this site. You can allow them in your browser’s settings.',
  unsupported: 'This browser doesn’t support notifications.',
}

function NotificationSettings() {
  const { status, error, enable, disable } = usePush()
  return (
    <>
      {status in PUSH_HELP && <p className="note flush">{PUSH_HELP[status]}</p>}
      {status === 'off' && <button className="primary small fit" onClick={enable}>Turn on on this device</button>}
      {status === 'on' && (
        <>
          <p className="note flush">On for this device. To choose which friends can notify you, tap a friend in your list.</p>
          <button className="secondary small fit" onClick={disable}>Turn off on this device</button>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  )
}

function InstallHelp() {
  const { canPrompt, install } = useInstallPrompt()
  if (canPrompt) return <button className="primary small fit" onClick={install}>Add to home screen</button>
  return (
    <p className="note flush">
      {isIOS()
        ? 'In Safari, tap the Share button, then Add to Home Screen.'
        : 'Open your browser’s menu and choose Install app or Add to Home Screen.'}
    </p>
  )
}

function AvatarPicker({ current, onPick }) {
  return (
    <div className="avatar-grid" role="group" aria-label="Profile picture">
      {AVATARS.map(([emoji, label]) => (
        <button key={emoji} className="avatar-option" aria-label={label} aria-pressed={current === emoji} onClick={() => onPick(emoji)}>{emoji}</button>
      ))}
      <button className="avatar-option initials" aria-pressed={!current} onClick={() => onPick(null)}>Initials</button>
    </div>
  )
}

function NameForm({ current, onSave, onCancel }) {
  const [name, setName] = useState(current)
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onSave(name.trim()) }}>
      <label>Your name<input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>
      <div className="form-actions">
        <button className="primary small">Save</button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function DetailsForm({ me, onSave, onCancel }) {
  const [whatsapp, setWhatsapp] = useState(me.whatsapp ? `+${me.whatsapp}` : '')
  const [usually, setUsually] = useState(me.usually ?? '')
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onSave(whatsapp, usually) }}>
      <label>WhatsApp number (optional)
        <input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} autoComplete="tel" />
      </label>
      <label>Usually free (optional)
        <input value={usually} maxLength={40} onChange={(e) => setUsually(e.target.value)} />
      </label>
      <p className="note flush">Only friends see these. Add your country code, like +91 98765 43210, and write something like “weekdays after 9 PM”.</p>
      <div className="form-actions">
        <button className="primary small">Save</button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function DeleteForm({ handle, onDelete }) {
  const [typed, setTyped] = useState('')
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onDelete(typed) }}>
      <p className="note flush">This removes your account, friends and plans for good. Type @{handle} without the @ to confirm.</p>
      <label>Your user ID
        <input value={typed} onChange={(e) => setTyped(e.target.value)} required autoCapitalize="none" autoCorrect="off" spellCheck="false" />
      </label>
      <div className="form-actions">
        <button className="danger" disabled={typed.trim().toLowerCase() !== handle}>Delete my account</button>
      </div>
    </form>
  )
}
