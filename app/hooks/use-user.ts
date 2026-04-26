
import { useState, useEffect } from 'react'
import { getUser, subscribeUser, type UserProfile } from '~/lib/user-store'

export function useUser(): UserProfile {
  const [user, setUser] = useState<UserProfile>(getUser)

  useEffect(() => {
    // Sync on mount (SSR safe)
    setUser(getUser())
    const unsub = subscribeUser(() => setUser({ ...getUser() }))
    return unsub
  }, [])

  return user
}
