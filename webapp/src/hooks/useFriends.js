import { useState, useRef, useEffect } from 'react'

const tg = window.Telegram?.WebApp

export default function useFriends({ profileSettings, triggerSelectionHaptic, triggerNotificationHaptic }) {
  const [friends, setFriends] = useState([])
  const [pendingFriends, setPendingFriends] = useState([])
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [friendsLoadingUi, setFriendsLoadingUi] = useState(false)
  const [friendUsername, setFriendUsername] = useState('')
  const [friendError, setFriendError] = useState('')
  const [maxFriends, setMaxFriends] = useState(6)
  const [markWithFriends, setMarkWithFriends] = useState(false)
  const [selectedFriendIds, setSelectedFriendIds] = useState([])
  const friendsLoadingUiTimerRef = useRef(null)

  useEffect(() => {
    return () => {
      if (friendsLoadingUiTimerRef.current) { clearTimeout(friendsLoadingUiTimerRef.current); friendsLoadingUiTimerRef.current = null }
    }
  }, [])

  const loadFriends = async () => {
    setFriendsLoading(true)
    if (friendsLoadingUiTimerRef.current) clearTimeout(friendsLoadingUiTimerRef.current)
    friendsLoadingUiTimerRef.current = setTimeout(() => setFriendsLoadingUi(true), 180)
    try {
      const [friendsRes, pendingRes] = await Promise.all([
        fetch('/api/friends', { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } }),
        fetch('/api/friends/pending', { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } })
      ])
      const friendsData = await friendsRes.json()
      const pendingData = await pendingRes.json()
      if (friendsData.success) {
        const nextFriends = friendsData.friends || []
        setFriends(nextFriends)
        setMaxFriends(friendsData.max_friends || 6)
        if (profileSettings.mark_with_friends_default && profileSettings.auto_select_favorites) {
          const favoriteIds = nextFriends.filter(f => f.is_favorite).map(f => f.id)
          if (markWithFriends) setSelectedFriendIds(favoriteIds)
        }
      }
      if (pendingData.success) setPendingFriends(pendingData.pending || [])
    } catch (err) {
      console.error('Failed to load friends:', err)
    } finally {
      setFriendsLoading(false)
      if (friendsLoadingUiTimerRef.current) { clearTimeout(friendsLoadingUiTimerRef.current); friendsLoadingUiTimerRef.current = null }
      setFriendsLoadingUi(false)
    }
  }

  const sendFriendRequest = async () => {
    const username = friendUsername.trim()
    if (!username) { setFriendError('Введи username друга'); return }
    setFriendError('')
    try {
      const response = await fetch('/api/friends/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg?.initData || '' },
        body: JSON.stringify({ username })
      })
      const data = await response.json()
      if (data.success) { setFriendUsername(''); triggerNotificationHaptic('success') }
      else { setFriendError(data.message || 'Ошибка'); triggerNotificationHaptic('error') }
    } catch (_err) {
      setFriendError('Ошибка соединения')
    }
  }

  const acceptFriend = async (requestId) => {
    try {
      const response = await fetch('/api/friends/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg?.initData || '' },
        body: JSON.stringify({ request_id: requestId })
      })
      const data = await response.json()
      if (data.success) { loadFriends(); triggerNotificationHaptic('success') }
    } catch (_err) {}
  }

  const rejectFriend = async (requestId) => {
    try {
      await fetch('/api/friends/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg?.initData || '' },
        body: JSON.stringify({ request_id: requestId })
      })
      loadFriends()
    } catch (_err) {}
  }

  const removeFriend = async (friendId) => {
    try {
      await fetch('/api/friends/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg?.initData || '' },
        body: JSON.stringify({ friend_id: friendId })
      })
      loadFriends()
    } catch (_err) {}
  }

  const toggleFriendFavorite = async (relationId) => {
    // Optimistic UI: reflect favorite state instantly, rollback on failure.
    setFriends(prevFriends => prevFriends.map(f =>
      f.relation_id === relationId ? { ...f, is_favorite: !f.is_favorite } : f
    ))

    try {
      const response = await fetch('/api/friends/toggle-favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg?.initData || '' },
        body: JSON.stringify({ relation_id: relationId })
      })
      const data = await response.json()
      if (!data.success) {
        setFriends(prevFriends => prevFriends.map(f =>
          f.relation_id === relationId ? { ...f, is_favorite: !f.is_favorite } : f
        ))
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
      setFriends(prevFriends => prevFriends.map(f =>
        f.relation_id === relationId ? { ...f, is_favorite: !f.is_favorite } : f
      ))
    }
  }

  const toggleFriendSelection = (friendId) => {
    triggerSelectionHaptic()
    setSelectedFriendIds(prev => {
      if (prev.includes(friendId)) {
        return prev.filter(id => id !== friendId)
      } else {
        return [...prev, friendId]
      }
    })
  }

  const handleSetMarkWithFriends = (enabled) => {
    triggerSelectionHaptic()
    setMarkWithFriends(enabled)
    if (enabled) {
      if (profileSettings.auto_select_favorites) {
        const favoriteIds = friends.filter(f => f.is_favorite).map(f => f.id)
        setSelectedFriendIds(favoriteIds)
      } else {
        setSelectedFriendIds([])
      }
    } else {
      setSelectedFriendIds([])
    }
  }

  const resetFriends = () => {
    setFriends([])
    setPendingFriends([])
  }

  return {
    friends, setFriends,
    pendingFriends, setPendingFriends,
    friendsLoading, friendsLoadingUi,
    friendUsername, setFriendUsername,
    friendError,
    maxFriends,
    markWithFriends, setMarkWithFriends,
    selectedFriendIds, setSelectedFriendIds,
    loadFriends, sendFriendRequest,
    acceptFriend, rejectFriend, removeFriend,
    toggleFriendFavorite, toggleFriendSelection,
    handleSetMarkWithFriends, resetFriends
  }
}
