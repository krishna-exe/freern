import { useCallback, useEffect, useState } from 'react'
import { disablePush, enablePush, pushStatus } from './push'

export function usePush() {
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  const check = useCallback(() => pushStatus().then(setStatus), [])
  useEffect(() => { check() }, [check])

  const change = useCallback(async (action) => {
    setError('')
    try {
      await action()
    } catch {
      setError('That didn’t work. Try again in a moment.')
    }
    await check()
  }, [check])

  return {
    status,
    error,
    enable: () => change(enablePush),
    disable: () => change(disablePush),
  }
}
