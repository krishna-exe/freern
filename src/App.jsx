import { useEffect, useState } from 'react'
import * as api from './lib/api'
import { Auth } from './screens/Auth'
import { Home } from './screens/Home'

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    if (!api.supabase) return
    api.supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = api.supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!api.supabase) return <main className="page"><p className="error">Missing Supabase config. See README.</p></main>
  if (session === undefined) return null
  if (!session) return <Auth />
  return <Home key={session.user.id} myId={session.user.id} />
}
