import { useEffect, useRef, useState } from 'react'
import { subscribeChannel, unsubscribeChannel } from '~/lib/pusher.client'

// Subscribe to a single event on a channel. The channel is shared (refcounted)
// so multiple hooks may listen to different events on the same channel without
// unsubscribing each other. The pusher-js library is loaded lazily on the
// client; until it resolves, subscriptions are queued (handled internally by
// the awaited subscribe call).
export function usePusherEvent<T = unknown>(
  channelName: string | null,
  eventName: string,
  handler: (data: T) => void,
): void {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!channelName) return
    let cancelled = false
    let boundChannel: Awaited<ReturnType<typeof subscribeChannel>> = null
    const fn = (data: T) => handlerRef.current(data)

    subscribeChannel(channelName).then(ch => {
      if (cancelled || !ch) return
      boundChannel = ch
      ch.bind(eventName, fn)
    })

    return () => {
      cancelled = true
      if (boundChannel) boundChannel.unbind(eventName, fn)
      unsubscribeChannel(channelName)
    }
  }, [channelName, eventName])
}

export interface PresenceMember {
  id: string
  info: { kind: 'admin' | 'user'; name?: string; tel?: string }
}

// Subscribe to a presence channel and return the live members list.
export function usePresenceMembers(channelName: string | null): PresenceMember[] {
  const [members, setMembers] = useState<PresenceMember[]>([])

  useEffect(() => {
    if (!channelName) return
    let cancelled = false
    let boundChannel: Awaited<ReturnType<typeof subscribeChannel>> = null

    function refresh(channel: NonNullable<typeof boundChannel>) {
      const presence = channel as unknown as {
        members: { each: (cb: (m: { id: string; info: PresenceMember['info'] }) => void) => void }
      }
      const list: PresenceMember[] = []
      presence.members.each(m => list.push({ id: m.id, info: m.info }))
      setMembers(list)
    }

    subscribeChannel(channelName).then(ch => {
      if (cancelled || !ch) return
      boundChannel = ch
      const onChange = () => refresh(ch)
      ch.bind('pusher:subscription_succeeded', onChange)
      ch.bind('pusher:member_added', onChange)
      ch.bind('pusher:member_removed', onChange)
    })

    return () => {
      cancelled = true
      if (boundChannel) {
        boundChannel.unbind('pusher:subscription_succeeded')
        boundChannel.unbind('pusher:member_added')
        boundChannel.unbind('pusher:member_removed')
      }
      unsubscribeChannel(channelName)
    }
  }, [channelName])

  return members
}
