import { normalizeHandle } from './api'

// A shared link looks like #/add/aayush.
export const handleFromHash = () => {
  const m = window.location.hash.match(/^#\/add\/([^/]+)$/)
  return m ? normalizeHandle(decodeURIComponent(m[1])) : ''
}
