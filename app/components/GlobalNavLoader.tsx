import { useEffect, useState } from 'react'
import { useLocation, useNavigation } from 'react-router'

// Delay before the bar appears so instantaneous navigations don't flash it.
const SHOW_AFTER_MS = 120

// Top-of-viewport progress bar that animates while React Router is fetching
// loaders for the next page. Hidden on `/admin/*` so the customer-themed
// gold/purple bar doesn't bleed into the admin dashboard.
export function GlobalNavLoader() {
  const navigation = useNavigation()
  const location = useLocation()
  const [visible, setVisible] = useState(false)

  const onAdmin = location.pathname.startsWith('/admin')
  const pending = navigation.state !== 'idle'

  useEffect(() => {
    if (onAdmin || !pending) {
      setVisible(false)
      return
    }
    const id = setTimeout(() => setVisible(true), SHOW_AFTER_MS)
    return () => clearTimeout(id)
  }, [pending, onAdmin])

  if (onAdmin || !visible) return null

  return (
    <div
      aria-hidden
      role="progressbar"
      className="fixed inset-x-0 top-0 z-[200] h-[3px] overflow-hidden pointer-events-none"
      style={{ background: 'rgba(76,29,149,0.35)' }}
    >
      <div
        className="h-full w-full"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, #fde68a 35%, #fbbf24 50%, #fde68a 65%, transparent 100%)',
          animation: 'pupatao-nav-loader 1.1s ease-in-out infinite',
        }}
      />
    </div>
  )
}
