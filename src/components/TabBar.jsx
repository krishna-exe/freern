const iconProps = {
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
}
const IconNow = () => (
  <svg {...iconProps}><rect x="2" y="7" width="20" height="10" rx="5" /><circle cx="16.5" cy="12" r="2" /></svg>
)
const IconPlans = () => (
  <svg {...iconProps}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
)
const IconFriends = () => (
  <svg {...iconProps}><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4.5a4 4 0 0 1 0 7M18.5 15.5c2.2.7 3.5 2.6 3.5 5.5" /></svg>
)

const TABS = [
  { id: 'now', label: 'Now', Icon: IconNow },
  { id: 'plans', label: 'Plans', Icon: IconPlans },
  { id: 'friends', label: 'Friends', Icon: IconFriends },
]

export function TabBar({ tab, badges, onOpen }) {
  return (
    <nav className="tabs" aria-label="Main">
      {TABS.map(({ id, label, Icon }) => (
        <TabButton key={id} id={id} label={label} tab={tab} onOpen={onOpen} badge={badges[id] ?? 0} icon={<Icon />} />
      ))}
    </nav>
  )
}

function TabButton({ id, label, tab, onOpen, badge = 0, icon }) {
  return (
    <button className="tab" aria-current={tab === id ? 'page' : undefined}
      aria-label={badge ? `${label}, ${badge} new` : label} onClick={() => onOpen(id)}>
      <span className="tab-icon">
        {icon}
        {badge > 0 && <span className="badge">{badge}</span>}
      </span>
      {label}
    </button>
  )
}
