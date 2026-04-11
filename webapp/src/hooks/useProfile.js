import { useEffect, useRef, useState } from 'react'

const tg = window.Telegram?.WebApp

export const DEFAULT_TABS = ['scanner', 'schedule', 'maps', 'passes', 'grades', 'esports']

export default function useProfile({
  sheetOpen,
  sheetAnimatingUntilRef,
  friendsRef
} = {}) {
  const [profileData, setProfileData] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileLoadingUi, setProfileLoadingUi] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSettings, setProfileSettings] = useState({
    share_mirea_login: false,
    mark_with_friends_default: false,
    auto_select_favorites: true,
    haptics_enabled: true,
    theme_mode: (() => {
      try {
        const raw = localStorage.getItem('theme_mode')
        if (raw === 'light' || raw === 'ocean' || raw === 'custom') return raw
      } catch {}
      return 'dark'
    })(),
    visible_tabs: (() => {
      try {
        const raw = localStorage.getItem('visible_tabs')
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed) && parsed.length > 0) return parsed
        }
      } catch {}
      return DEFAULT_TABS
    })()
  })
  const [hapticsEnabled, setHapticsEnabled] = useState(() => {
    try {
      const raw = localStorage.getItem('haptics_enabled')
      if (raw === '0') return false
      if (raw === '1') return true
    } catch {}
    return true
  })
  const [themeMode, setThemeMode] = useState(() => {
    try {
      const raw = localStorage.getItem('theme_mode')
      if (raw === 'light' || raw === 'ocean' || raw === 'custom') return raw
    } catch {}
    return 'dark'
  })
  const [connectionCheckLoading, setConnectionCheckLoading] = useState(false)
  const [connectionCheckResult, setConnectionCheckResult] = useState(null)

  const profileLoadingUiTimerRef = useRef(null)
  const bufferedProfileDataRef = useRef(null)
  const bufferedProfileApplyTimerRef = useRef(null)
  const connectionCheckResultTimerRef = useRef(null)

  const clearConnectionCheckResultTimer = () => {
    if (connectionCheckResultTimerRef.current) {
      clearTimeout(connectionCheckResultTimerRef.current)
      connectionCheckResultTimerRef.current = null
    }
  }

  const setTimedConnectionCheckResult = (value) => {
    clearConnectionCheckResultTimer()
    setConnectionCheckResult(value)
    if (!value?.message) return
    connectionCheckResultTimerRef.current = setTimeout(() => {
      setConnectionCheckResult((prev) => {
        if (!prev) return prev
        if (prev.checked_at !== value.checked_at) return prev
        return null
      })
      connectionCheckResultTimerRef.current = null
    }, 5000)
  }

  const notifyHaptic = (kind = 'success') => {
    if (!hapticsEnabled) return
    const haptic = tg?.HapticFeedback
    if (!haptic || typeof haptic.notificationOccurred !== 'function') return
    try { haptic.notificationOccurred(kind) } catch {}
  }

  const normalizeProfileSettings = (source = {}) => {
    let theme = source.theme_mode
    if (theme !== 'dark' && theme !== 'light' && theme !== 'ocean' && theme !== 'custom') {
      theme = source.light_theme_enabled === true ? 'light' : 'dark'
    }
    return {
      share_mirea_login: !!source.share_mirea_login,
      mark_with_friends_default: !!source.mark_with_friends_default,
      auto_select_favorites: source.auto_select_favorites !== false,
      haptics_enabled: source.haptics_enabled !== false,
      theme_mode: theme,
      visible_tabs: Array.isArray(source.visible_tabs) && source.visible_tabs.length > 0
        ? source.visible_tabs
        : DEFAULT_TABS
    }
  }

  const applyScannerBehaviorDefaults = (settings, friendsList) => {
    const ref = friendsRef?.current || {}
    const setMWF = ref.setMarkWithFriends
    const setSFI = ref.setSelectedFriendIds
    if (typeof setMWF !== 'function' || typeof setSFI !== 'function') return
    const friends = friendsList !== undefined ? friendsList : (ref.friends || [])
    const normalized = normalizeProfileSettings(settings || {})
    setMWF(!!normalized.mark_with_friends_default)
    if (!normalized.mark_with_friends_default) {
      setSFI([])
      return
    }
    if (normalized.auto_select_favorites) {
      const favoriteIds = (friends || []).filter(f => f.is_favorite).map(f => f.id)
      setSFI(favoriteIds)
    } else {
      setSFI([])
    }
  }

  useEffect(() => () => {
    clearConnectionCheckResultTimer()
  }, [])

  const loadProfile = async () => {
    setProfileLoading(true)
    setProfileError('')
    if (profileLoadingUiTimerRef.current) clearTimeout(profileLoadingUiTimerRef.current)

    const animUntil = sheetAnimatingUntilRef?.current || 0
    if (sheetOpen || Date.now() < animUntil) {
      const now = Date.now()
      const animRemaining = now < animUntil ? (animUntil - now) : 0
      profileLoadingUiTimerRef.current = setTimeout(
        () => setProfileLoadingUi(true),
        Math.max(180, animRemaining + 140)
      )
    }

    try {
      const response = await fetch('/api/profile', {
        headers: { 'X-Telegram-Init-Data': tg?.initData || '' }
      })
      const data = await response.json()
      if (data.success) {
        const normalizedSettings = normalizeProfileSettings(data.account || {})
        setProfileSettings(normalizedSettings)
        setHapticsEnabled(normalizedSettings.haptics_enabled)
        setThemeMode(normalizedSettings.theme_mode)
        try { localStorage.setItem('haptics_enabled', normalizedSettings.haptics_enabled ? '1' : '0') } catch {}
        try { localStorage.setItem('theme_mode', normalizedSettings.theme_mode) } catch {}
        try { localStorage.setItem('visible_tabs', JSON.stringify(normalizedSettings.visible_tabs)) } catch {}
        applyScannerBehaviorDefaults(normalizedSettings)

        const normalizedProfile = {
          ...data,
          account: { ...(data.account || {}), ...normalizedSettings }
        }

        const nowApply = Date.now()
        const delay = nowApply < animUntil ? (animUntil - nowApply) : 0
        if (delay > 0) {
          bufferedProfileDataRef.current = normalizedProfile
          if (bufferedProfileApplyTimerRef.current) clearTimeout(bufferedProfileApplyTimerRef.current)
          bufferedProfileApplyTimerRef.current = setTimeout(() => {
            if (bufferedProfileDataRef.current) setProfileData(bufferedProfileDataRef.current)
            bufferedProfileDataRef.current = null
            bufferedProfileApplyTimerRef.current = null
          }, delay + 16)
        } else {
          setProfileData(normalizedProfile)
        }
      } else {
        setProfileError(data.message || 'Не удалось загрузить профиль')
      }
    } catch (err) {
      setProfileError('Ошибка соединения')
    } finally {
      setProfileLoading(false)
      if (profileLoadingUiTimerRef.current) {
        clearTimeout(profileLoadingUiTimerRef.current)
        profileLoadingUiTimerRef.current = null
      }
      setProfileLoadingUi(false)
    }
  }

  const updateProfileSettings = async (patch) => {
    // Optimistic update — apply immediately for snappy UI
    const optimistic = normalizeProfileSettings({ ...profileSettings, ...patch })
    setProfileSettings(optimistic)
    setHapticsEnabled(optimistic.haptics_enabled)
    setThemeMode(optimistic.theme_mode)
    try { localStorage.setItem('haptics_enabled', optimistic.haptics_enabled ? '1' : '0') } catch {}
    try { localStorage.setItem('theme_mode', optimistic.theme_mode) } catch {}
    try { localStorage.setItem('visible_tabs', JSON.stringify(optimistic.visible_tabs)) } catch {}

    if (
      Object.prototype.hasOwnProperty.call(patch || {}, 'mark_with_friends_default')
      || Object.prototype.hasOwnProperty.call(patch || {}, 'auto_select_favorites')
    ) {
      applyScannerBehaviorDefaults(optimistic)
    }

    setProfileData((prev) => {
      if (!prev) return prev
      return { ...prev, account: { ...(prev.account || {}), ...optimistic } }
    })

    try {
      const response = await fetch('/api/profile/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg?.initData || '' },
        body: JSON.stringify(patch)
      })
      const data = await response.json()
      if (!data.success) {
        // Rollback on failure
        setProfileSettings(profileSettings)
        setProfileError(data.message || 'Не удалось сохранить настройки')
        return false
      }
      return true
    } catch (err) {
      setProfileSettings(profileSettings)
      setProfileError('Ошибка соединения')
      return false
    }
  }

  const checkProfileConnection = async () => {
    setConnectionCheckLoading(true)
    clearConnectionCheckResultTimer()
    setConnectionCheckResult(null)
    try {
      const response = await fetch('/api/profile/check-connection', {
        method: 'POST',
        headers: { 'X-Telegram-Init-Data': tg?.initData || '' }
      })
      const data = await response.json()
      const ok = !!data.success
      setTimedConnectionCheckResult({
        ok,
        message: data.message || (ok ? 'Соединение активно' : 'Проверка не пройдена'),
        checked_at: data.checked_at || new Date().toISOString(),
        last_sync_at: data.last_sync_at || null
      })
      notifyHaptic(ok ? 'success' : 'error')
      return ok
    } catch (err) {
      setTimedConnectionCheckResult({
        ok: false,
        message: 'Ошибка соединения',
        checked_at: new Date().toISOString(),
        last_sync_at: null
      })
      notifyHaptic('error')
      return false
    } finally {
      setConnectionCheckLoading(false)
    }
  }

  return {
    profileData, setProfileData,
    profileLoading,
    profileLoadingUi,
    profileError, setProfileError,
    profileSettings, setProfileSettings,
    hapticsEnabled,
    themeMode,
    connectionCheckLoading,
    connectionCheckResult,
    loadProfile,
    updateProfileSettings,
    checkProfileConnection,
    clearConnectionCheckResultTimer,
    setTimedConnectionCheckResult,
    applyScannerBehaviorDefaults
  }
}

