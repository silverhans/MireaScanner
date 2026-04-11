import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import useAnimatedPresence, { SHEET_ANIM_MS, MODAL_ANIM_MS } from './hooks/useAnimatedPresence'
import useSchedule from './hooks/useSchedule'
import useGrades from './hooks/useGrades'
import useScanner from './hooks/useScanner'
import useEsports from './hooks/useEsports'
import useAuth from './hooks/useAuth'
import useSystemHealth from './hooks/useSystemHealth'
import useAcs from './hooks/useAcs'
import useAttendanceDetail from './hooks/useAttendanceDetail'
import useProfile from './hooks/useProfile'
import useConfirm from './hooks/useConfirm'
import useHaptics from './hooks/useHaptics'
import useFriends from './hooks/useFriends'
import { TELEGRAM_CHANNEL_URL } from './constants'
import TabBar from './components/TabBar'
import LoginForm from './components/LoginForm'
import ScannerTab from './components/ScannerTab'
import ScheduleTab from './components/ScheduleTab'
import MapsTab from './components/MapsTab'
import PassesTab from './components/PassesTab'
import GradesTab from './components/GradesTab'
import EsportsTab from './components/EsportsTab'
import ProfileSheet, { applyCustomTheme, clearCustomTheme } from './components/ProfileSheet'
import FriendsModal from './components/FriendsModal'
import ConfirmDialog from './components/ConfirmDialog'

const tg = window.Telegram?.WebApp

function App() {
  const [activeTab, setActiveTab] = useState('scanner')

  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetStack, setSheetStack] = useState([{ name: 'profile' }])
  const [sheetNav, setSheetNav] = useState('none')
  const [attendanceInfoOpen, setAttendanceInfoOpen] = useState(false)
  const [friendsModalOpen, setFriendsModalOpen] = useState(false)
  const [friendsModalScreen, setFriendsModalScreen] = useState('list')
  const [friendsModalNav, setFriendsModalNav] = useState('none')
  const [friendsModalParams, setFriendsModalParams] = useState(null)
  const [friendProfileLoading, setFriendProfileLoading] = useState(false)
  const [friendProfileError, setFriendProfileError] = useState('')
  const [friendProfileNotice, setFriendProfileNotice] = useState('')
  const [friendProfile, setFriendProfile] = useState(null)

  const sheetCloseResetRef = useRef(null)
  const sheetBodyRef = useRef(null)
  const sheetScrollStack = useRef([])
  const sheetAnimatingUntilRef = useRef(0)
  const friendsHeaderBtnRef = useRef(null)
  const friendsQuickBtnRef = useRef(null)
  const friendsModalRef = useRef(null)
  const friendsScrollRef = useRef(null)
  const friendsScrollTopRef = useRef(0)
  const friendsOriginViewportRef = useRef(null)

  const [tabDirection, setTabDirection] = useState('none')
  const friendsRef = useRef({})

  // --- Custom hooks ---

  const profile = useProfile({ sheetOpen, sheetAnimatingUntilRef, friendsRef })
  const haptics = useHaptics(profile.hapticsEnabled)
  const auth = useAuth({ onNotify: haptics.triggerNotificationHaptic })
  const schedule = useSchedule({ isAuthorized: auth.isAuthorized })
  const grades = useGrades({ isAuthorized: auth.isAuthorized, activeTab })
  const attendanceDetail = useAttendanceDetail()
  const systemHealth = useSystemHealth()
  const acs = useAcs({ isAuthorized: auth.isAuthorized })
  const confirm = useConfirm()
  const fr = useFriends({
    profileSettings: profile.profileSettings,
    triggerSelectionHaptic: haptics.triggerSelectionHaptic,
    triggerNotificationHaptic: haptics.triggerNotificationHaptic
  })
  const scanner = useScanner({
    markWithFriends: fr.markWithFriends,
    friendsCount: fr.friends.length,
    selectedFriendIds: fr.selectedFriendIds,
    hapticsEnabled: profile.hapticsEnabled,
    onNeedsAuth: () => auth.setIsAuthorized(false)
  })
  const esports = useEsports()

  // Keep friendsRef in sync for useProfile (avoids circular dependency)
  friendsRef.current = { friends: fr.friends, setMarkWithFriends: fr.setMarkWithFriends, setSelectedFriendIds: fr.setSelectedFriendIds }

  const visibleTabs = profile.profileSettings.visible_tabs
  const activeTabIndex = Math.max(0, visibleTabs.indexOf(activeTab))

  // Reset to scanner if active tab was removed from visible tabs
  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab('scanner')
    }
  }, [visibleTabs])

  // --- Animated presence ---

  const sheetPresence = useAnimatedPresence(sheetOpen, SHEET_ANIM_MS)
  const attendanceInfoPresence = useAnimatedPresence(attendanceInfoOpen, MODAL_ANIM_MS)
  const friendsModalPresence = useAnimatedPresence(friendsModalOpen, MODAL_ANIM_MS)
  const confirmPresence = useAnimatedPresence(confirm.confirmOpen, MODAL_ANIM_MS)

  // --- Telegram insets ---
  const syncTelegramInsets = () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const safeTop = Math.max(0,
      tg?.contentSafeAreaInset?.top ?? tg?.safeAreaInset?.top ?? (isIOS ? 56 : 0)
    )
    const safeBottom = Math.max(0,
      tg?.contentSafeAreaInset?.bottom ?? tg?.safeAreaInset?.bottom ?? 0
    )
    document.documentElement.style.setProperty('--tg-chrome-top', `${safeTop}px`)
    document.documentElement.style.setProperty('--tg-chrome-bottom', `${safeBottom}px`)
  }

  useLayoutEffect(() => { syncTelegramInsets() }, [])

  useLayoutEffect(() => {
    if (!friendsModalPresence.shouldRender) return
    const modalEl = friendsModalRef.current
    const origin = friendsOriginViewportRef.current
    if (!modalEl || !origin) return
    const rect = modalEl.getBoundingClientRect()
    const ox = origin.x - rect.left
    const oy = origin.y - rect.top
    modalEl.style.setProperty('--origin-x', `${ox}px`)
    modalEl.style.setProperty('--origin-y', `${oy}px`)
  }, [friendsModalPresence.shouldRender])

  useEffect(() => {
    if (!sheetPresence.shouldRender) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [sheetPresence.shouldRender])

  useEffect(() => {
    if (!friendsModalPresence.shouldRender) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [friendsModalPresence.shouldRender])

  // --- Init ---
  useEffect(() => {
    if (tg) {
      tg.ready()
      tg.expand()
      const tgBg = profile.themeMode === 'light' ? '#eef2f7' : profile.themeMode === 'ocean' ? '#0b1628' : '#0a0a0a'
      tg.setHeaderColor(tgBg)
      tg.setBackgroundColor(tgBg)
      syncTelegramInsets()
    }
    auth.checkAuthStatus()
    systemHealth.loadSystemHealth()
    return () => scanner.stopScanner()
  }, [])

  useEffect(() => {
    const mode = profile.themeMode || 'dark'
    if (mode === 'custom') {
      document.documentElement.setAttribute('data-theme', 'dark')
      try {
        const raw = localStorage.getItem('custom_theme_colors')
        if (raw) applyCustomTheme(JSON.parse(raw))
      } catch {}
    } else {
      clearCustomTheme()
      document.documentElement.setAttribute('data-theme', mode)
    }
    try { localStorage.setItem('theme_mode', mode) } catch (_e) {}
    if (tg) {
      try {
        let tgBg = '#0a0a0a'
        if (mode === 'light') tgBg = '#eef2f7'
        else if (mode === 'ocean') tgBg = '#0b1628'
        else if (mode === 'custom') {
          try { tgBg = JSON.parse(localStorage.getItem('custom_theme_colors') || '{}').bg_primary || '#0a0a0a' } catch {}
        }
        tg.setHeaderColor(tgBg)
        tg.setBackgroundColor(tgBg)
      } catch (_e) {}
    }
  }, [profile.themeMode])

  // --- API functions ---

  useEffect(() => {
    if (auth.isAuthorized !== false) return
    profile.clearConnectionCheckResultTimer()
    profile.setTimedConnectionCheckResult(null)
    fr.setMarkWithFriends(false)
    fr.setSelectedFriendIds([])
  }, [auth.isAuthorized])

  useEffect(() => {
    if (auth.isAuthorized !== true) return
    fr.loadFriends()
    profile.loadProfile()
    acs.loadAcsEvents()
  }, [auth.isAuthorized])

  // --- Sheet navigation ---

  const openProfileSheet = () => {
    if (sheetCloseResetRef.current) { clearTimeout(sheetCloseResetRef.current); sheetCloseResetRef.current = null }
    sheetAnimatingUntilRef.current = Date.now() + SHEET_ANIM_MS
    sheetScrollStack.current = []
    setAttendanceInfoOpen(false)
    setFriendsModalOpen(false)
    confirm.setConfirmOpen(false)
    setSheetNav('none')
    setSheetStack([{ name: 'profile' }])
    setSheetOpen(true)
    requestAnimationFrame(() => requestAnimationFrame(() => profile.loadProfile()))
    requestAnimationFrame(() => requestAnimationFrame(() => systemHealth.loadSystemHealth()))
  }

  const closeSheet = () => {
    setAttendanceInfoOpen(false)
    setFriendsModalOpen(false)
    confirm.setConfirmOpen(false)
    setSheetOpen(false)
    if (sheetCloseResetRef.current) clearTimeout(sheetCloseResetRef.current)
    sheetCloseResetRef.current = setTimeout(() => {
      setSheetStack([{ name: 'profile' }])
      setSheetNav('none')
      setFriendProfile(null)
      setFriendProfileError('')
      setFriendProfileNotice('')
      setFriendProfileLoading(false)
      sheetCloseResetRef.current = null
    }, SHEET_ANIM_MS)
  }

  const pushSheet = (name, params = {}) => {
    setAttendanceInfoOpen(false)
    setFriendsModalOpen(false)
    confirm.setConfirmOpen(false)
    const scrollTop = sheetBodyRef.current?.scrollTop || 0
    sheetScrollStack.current.push(scrollTop)
    setSheetNav('push')
    setSheetStack((prev) => [...(prev || [{ name: 'profile' }]), { name, params }])
    requestAnimationFrame(() => {
      if (sheetBodyRef.current) sheetBodyRef.current.scrollTop = 0
    })
  }

  const popSheet = () => {
    setFriendsModalOpen(false)
    confirm.setConfirmOpen(false)
    const savedScroll = sheetScrollStack.current.pop() ?? 0
    setSheetNav('pop')
    setSheetStack((prev) => {
      if (!prev || prev.length <= 1) return prev || [{ name: 'profile' }]
      return prev.slice(0, -1)
    })
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (sheetBodyRef.current) sheetBodyRef.current.scrollTop = savedScroll
    }))
  }

  useEffect(() => {
    if (sheetNav === 'none') return
    const t = setTimeout(() => setSheetNav('none'), 260)
    return () => clearTimeout(t)
  }, [sheetStack.length])

  useEffect(() => {
    if (friendsModalNav === 'none') return
    const t = setTimeout(() => setFriendsModalNav('none'), 260)
    return () => clearTimeout(t)
  }, [friendsModalScreen])

  useEffect(() => {
    if (friendsModalOpen) return
    setFriendsModalNav('none')
    setFriendsModalScreen('list')
    setFriendsModalParams(null)
  }, [friendsModalOpen])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sheetCloseResetRef.current) { clearTimeout(sheetCloseResetRef.current); sheetCloseResetRef.current = null }
      friendsOriginViewportRef.current = null
    }
  }, [])

  // --- Friends profile ---

  const openFriendProfile = async (friend) => {
    setFriendProfileError('')
    setFriendProfileNotice('')
    setFriendProfile(null)
    if (!friend?.id) return

    const friendParams = {
      telegram_id: friend.id,
      preview: { id: friend.id, name: friend.name, username: friend.username }
    }

    if (friendsModalOpen) {
      friendsScrollTopRef.current = friendsScrollRef.current?.scrollTop || 0
      setFriendsModalNav('push')
      setFriendsModalScreen('friendProfile')
      setFriendsModalParams(friendParams)
    } else {
      if (!sheetOpen) {
        if (sheetCloseResetRef.current) { clearTimeout(sheetCloseResetRef.current); sheetCloseResetRef.current = null }
        sheetAnimatingUntilRef.current = Date.now() + SHEET_ANIM_MS
        setAttendanceInfoOpen(false)
        setFriendsModalOpen(false)
        confirm.setConfirmOpen(false)
        setSheetNav('none')
        setSheetStack([{ name: 'profile' }, { name: 'friendProfile', params: friendParams }])
        setSheetOpen(true)
      } else {
        pushSheet('friendProfile', friendParams)
      }
    }

    setFriendProfileLoading(true)
    try {
      const params = new URLSearchParams({ telegram_id: String(friend.id) })
      const response = await fetch(`/api/friends/profile?${params.toString()}`, {
        headers: { 'X-Telegram-Init-Data': tg?.initData || '' }
      })
      const data = await response.json()
      if (response.status === 403 || data?.message === 'Forbidden') {
        setFriendProfileNotice('Подробная информация откроется после того, как вы добавите пользователя в друзья.')
      } else if (data.success) {
        setFriendProfile(data.friend)
      } else {
        setFriendProfileError(data.message || 'Не удалось загрузить профиль друга')
      }
    } catch (_err) {
      setFriendProfileError('Ошибка соединения')
    } finally {
      setFriendProfileLoading(false)
    }
  }

  const closeFriendsFriendProfile = () => {
    setFriendsModalNav('pop')
    setFriendsModalScreen('list')
    setFriendsModalParams(null)
    setFriendProfileLoading(false)
    setFriendProfileError('')
    setFriendProfileNotice('')
    setFriendProfile(null)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (friendsScrollRef.current) friendsScrollRef.current.scrollTop = friendsScrollTopRef.current || 0
    }))
  }

  // --- Auth handlers ---

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Telegram-Init-Data': tg?.initData || '' } })
      auth.setIsAuthorized(false)
      auth.setAccountInfo((prev) => ({ ...(prev || {}), authorized: false, login: null }))
      profile.setProfileData((prev) => (prev ? { ...prev, account: { ...(prev.account || {}), authorized: false, login: null } } : prev))
      profile.clearConnectionCheckResultTimer()
      profile.setTimedConnectionCheckResult(null)
      attendanceDetail.resetCache()
      auth.resetLoginFlow()
      closeSheet()
    } catch (_err) {}
  }

  const handleDeleteAccount = async () => {
    auth.setDeleteLoading(true)
    profile.setProfileError('')
    try {
      const response = await fetch('/api/auth/delete-account', { method: 'POST', headers: { 'X-Telegram-Init-Data': tg?.initData || '' } })
      let data = null
      try { data = await response.json() } catch (_err) {}
      if (!response.ok || !data?.success) { profile.setProfileError(data?.message || 'Не удалось удалить аккаунт'); return }
      auth.setIsAuthorized(false)
      auth.setAccountInfo(null)
      profile.setProfileData(null)
      fr.resetFriends()
      profile.clearConnectionCheckResultTimer()
      profile.setTimedConnectionCheckResult(null)
      schedule.reset()
      auth.resetLoginFlow()
      closeSheet()
    } catch (_err) {
      profile.setProfileError('Ошибка соединения')
    } finally {
      auth.setDeleteLoading(false)
    }
  }

  // --- Friends modal ---

  const openFriendsModalFromElement = (el) => {
    const rect = el?.getBoundingClientRect?.()
    if (rect) {
      friendsOriginViewportRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    } else {
      friendsOriginViewportRef.current = { x: window.innerWidth - 28, y: 24 }
    }
    setAttendanceInfoOpen(false); confirm.setConfirmOpen(false)
    setFriendsModalScreen('list'); setFriendsModalNav('none'); setFriendsModalParams(null)
    setFriendsModalOpen(true)
    requestAnimationFrame(() => requestAnimationFrame(() => fr.loadFriends()))
  }

  // --- Tab change ---

  const handleTabChange = (tab) => {
    if (tab === activeTab) return
    const newIndex = visibleTabs.indexOf(tab)
    if (newIndex !== -1 && newIndex !== activeTabIndex) {
      setTabDirection(newIndex > activeTabIndex ? 'tab-forward' : 'tab-back')
    } else {
      setTabDirection('none')
    }
    setActiveTab(tab)
    window.scrollTo(0, 0)
    if (tab === 'schedule' && !schedule.scheduleAttempted && !schedule.scheduleLoading) {
      schedule.setScheduleAttempted(true)
      schedule.loadGroupSchedule()
    }
    if (tab === 'passes' && !acs.acsLoading && acs.acsEvents.length === 0) {
      acs.loadAcsEvents()
    }
    if (tab === 'esports' && esports.esportsAuthorized === null) esports.checkStatus()
  }

  // --- Computed values ---

  const dashboardName = auth.accountInfo?.user_name || profile.profileData?.telegram?.full_name || tg?.initDataUnsafe?.user?.first_name || 'Личный кабинет'
  const dashboardLogin = auth.accountInfo?.login || profile.profileData?.account?.login || ''
  const dashboardGroup = schedule.groupName || localStorage.getItem('schedule_group') || ''
  const dashboardAuthorized = (auth.accountInfo?.authorized ?? auth.isAuthorized) === true
  const dashboardAuthLabel = dashboardAuthorized ? 'МИРЭА подключен' : 'Требуется вход'
  const pendingFriendsCount = fr.pendingFriends.length
  const pendingFriendsBadge = pendingFriendsCount > 99 ? '99+' : String(pendingFriendsCount)
  const friendsButtonLabel = pendingFriendsCount > 0 ? `Друзья (заявки: ${pendingFriendsCount})` : 'Друзья'

  const currentSheet = (sheetStack && sheetStack.length > 0) ? sheetStack[sheetStack.length - 1] : { name: 'profile', params: {} }
  const sheetScreenName = currentSheet?.name || 'profile'
  const sheetParams = currentSheet?.params || {}
  const sheetScreenKey = `${sheetScreenName}:${sheetParams.telegram_id || ''}:${sheetStack.length}`

  let sheetTitle = 'Профиль'
  let sheetSubtitle = (profile.profileData?.account?.authorized ?? auth.accountInfo?.authorized) ? 'МИРЭА подключен' : 'МИРЭА не подключен'
  if (sheetScreenName === 'friendProfile') {
    sheetTitle = 'Профиль друга'
    sheetSubtitle = sheetParams?.preview?.name || 'Информация доступна только друзьям'
  } else if (sheetScreenName === 'history') {
    sheetTitle = 'История'
    sheetSubtitle = 'Статистика и отметки'
  } else if (sheetScreenName === 'settings') {
    sheetTitle = 'Настройки'
    sheetSubtitle = 'Поведение и вкладки'
  } else if (sheetScreenName === 'service') {
    sheetTitle = 'Сервис'
    sheetSubtitle = 'Состояние системы'
  } else if (sheetScreenName === 'privacy') {
    sheetTitle = 'Конфиденциальность'
    sheetSubtitle = 'Политика обработки данных'
  }

  let friendsTitle = 'Друзья'
  let friendsSubtitle = `${fr.friends.length}/${fr.maxFriends} · Отмечайтесь вместе`
  if (friendsModalScreen === 'friendProfile') {
    friendsTitle = 'Профиль друга'
    friendsSubtitle = friendsModalParams?.preview?.name || 'Информация доступна только друзьям'
  }
  const friendsScreenKey = `${friendsModalScreen}:${friendsModalParams?.telegram_id || ''}`

  // --- Render ---

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <span className="logo">MIREA Scanner</span>
        {auth.isAuthorized !== null && (
          <div className="header-actions">
            <a href={TELEGRAM_CHANNEL_URL} target="_blank" rel="noopener noreferrer"
              className="menu-btn" title="Telegram канал" aria-label="Telegram канал">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
            </a>
            {auth.isAuthorized === true && (
              <button
                ref={friendsHeaderBtnRef}
                className="menu-btn friends-btn"
                onClick={() => openFriendsModalFromElement(friendsHeaderBtnRef.current)}
                title={friendsButtonLabel}
                aria-label={friendsButtonLabel}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <span className={`friends-plus ${pendingFriendsCount > 0 ? 'pending' : ''}`} aria-hidden="true">
                  {pendingFriendsCount > 0 ? pendingFriendsBadge : '+'}
                </span>
              </button>
            )}
            <button className="menu-btn" onClick={openProfileSheet} title="Аккаунт" aria-label="Профиль">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="6" x2="20" y2="6"></line>
                <line x1="4" y1="12" x2="20" y2="12"></line>
                <line x1="4" y1="18" x2="20" y2="18"></line>
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="main-content">
        {auth.isAuthorized === null && (
          <div className="scanner-section">
            <div className="status-message scanning scanning-indicator"><span>Загрузка...</span></div>
          </div>
        )}

        {auth.isAuthorized === false && (
          <LoginForm
            loginStep={auth.loginStep} loginError={auth.loginError} isLoggingIn={auth.isLoggingIn}
            loginPendingLogin={auth.loginPendingLogin} challengeKind={auth.loginChallengeKind}
            onLogin={auth.handleLogin} onOtp={auth.handleOtp} onReset={auth.resetLoginFlow}
            loginRef={auth.loginRef} passwordRef={auth.passwordRef} otpRef={auth.otpRef}
            onOpenPrivacy={() => {
              setSheetStack([{ name: 'privacy' }])
              setSheetOpen(true)
            }}
          />
        )}

        {auth.isAuthorized === true && (
          <>
            <TabBar activeTab={activeTab} onTabChange={handleTabChange} tabs={visibleTabs} />

            {activeTab === 'scanner' && (
              <ScannerTab
                status={scanner.status} message={scanner.message} results={scanner.results}
                useNativeScanner={scanner.useNativeScanner} tabDirection={tabDirection}
                dashboardName={dashboardName} dashboardLogin={dashboardLogin}
                dashboardGroup={dashboardGroup} dashboardAuthorized={dashboardAuthorized}
                dashboardAuthLabel={dashboardAuthLabel}
                todaySchedule={schedule.todaySchedule} scheduleLoading={schedule.scheduleLoading} scheduleError={schedule.scheduleError}
                friends={fr.friends} maxFriends={fr.maxFriends}
                markWithFriends={fr.markWithFriends}
                selectedFriendIds={fr.selectedFriendIds}
                onStartScanner={scanner.startScanner} onStopScanner={scanner.stopScanner} onResetScanner={scanner.resetScanner}
                onOpenProfile={openProfileSheet} onTabChange={handleTabChange}
                onOpenFriendsModal={openFriendsModalFromElement}
                onSetMarkWithFriends={fr.handleSetMarkWithFriends}
                onToggleFriendSelection={fr.toggleFriendSelection}
                friendsQuickBtnRef={friendsQuickBtnRef}
                visibleTabs={visibleTabs}
              />
            )}

            {activeTab === 'schedule' && (
              <ScheduleTab
                tabDirection={tabDirection}
                scheduleTabLoading={schedule.scheduleTabLoading} scheduleTabError={schedule.scheduleTabError}
                scheduleTabEvents={schedule.scheduleTabEvents}
                scheduleTabResolvedName={schedule.scheduleTabResolvedName}
                scheduleViewMode={schedule.scheduleViewMode} onSetScheduleViewMode={schedule.setScheduleViewMode}
                onSetScheduleFocusDate={schedule.setScheduleFocusDate}
                onShiftScheduleFocus={schedule.shiftScheduleFocus} formatScheduleRange={schedule.formatScheduleRange}
                scheduleDisplayKeys={schedule.scheduleDisplayKeys} scheduleByDayKey={schedule.scheduleByDayKey}
              />
            )}

            {activeTab === 'maps' && (
              <MapsTab tabDirection={tabDirection} />
            )}

            {activeTab === 'grades' && (
              <GradesTab
                gradesData={grades.gradesData} gradesLoading={grades.gradesLoading}
                gradesError={grades.gradesError} onRefresh={grades.loadGrades} tabDirection={tabDirection}
                attendanceDetail={attendanceDetail} onLoadAttendanceDetail={attendanceDetail.loadDetail}
              />
            )}

            {activeTab === 'passes' && (
              <PassesTab
                acsEvents={acs.acsEvents}
                acsLoading={acs.acsLoading}
                acsError={acs.acsError}
                onRefresh={acs.loadAcsEvents}
                tabDirection={tabDirection}
              />
            )}

            {activeTab === 'esports' && (
              <EsportsTab esports={esports} tabDirection={tabDirection} requestConfirm={confirm.requestConfirm} />
            )}

          </>
        )}
      </div>

      <div className="bottom-spacer"></div>

      <ProfileSheet
        sheetPresence={sheetPresence} sheetStack={sheetStack} sheetNav={sheetNav}
        sheetScreenName={sheetScreenName} sheetParams={sheetParams} sheetScreenKey={sheetScreenKey}
        sheetTitle={sheetTitle} sheetSubtitle={sheetSubtitle}
        profileData={profile.profileData} profileError={profile.profileError} profileLoadingUi={profile.profileLoadingUi}
        profileSettings={profile.profileSettings}
        connectionCheckLoading={profile.connectionCheckLoading}
        connectionCheckResult={profile.connectionCheckResult}
        isAuthorized={auth.isAuthorized} accountInfo={auth.accountInfo}
        groupName={schedule.groupName} deleteLoading={auth.deleteLoading}
        friendProfile={friendProfile} friendProfileLoading={friendProfileLoading}
        friendProfileError={friendProfileError} friendProfileNotice={friendProfileNotice}
        attendanceInfoPresence={attendanceInfoPresence} onSetAttendanceInfoOpen={setAttendanceInfoOpen}
        onCloseSheet={closeSheet} onPopSheet={popSheet} onPushSheet={pushSheet}
        sheetBodyRef={sheetBodyRef} visibleTabs={visibleTabs}
        onUpdateProfileSettings={profile.updateProfileSettings}
        onCheckProfileConnection={profile.checkProfileConnection}
        onRefreshSystemHealth={systemHealth.loadSystemHealth}
        onOpenFriendsModal={openFriendsModalFromElement}
        onLogout={handleLogout} onDeleteAccount={handleDeleteAccount}
        systemHealth={systemHealth.systemHealth}
        systemHealthLoading={systemHealth.systemHealthLoading}
        friends={fr.friends} maxFriends={fr.maxFriends}
        onSetConfirmOpen={confirm.setConfirmOpen} onSetFriendsModalOpen={setFriendsModalOpen}
        requestConfirm={confirm.requestConfirm}
      />

      <FriendsModal
        friendsModalPresence={friendsModalPresence}
        friendsModalScreen={friendsModalScreen} friendsModalNav={friendsModalNav}
        friendsModalParams={friendsModalParams}
        friendsTitle={friendsTitle} friendsSubtitle={friendsSubtitle} friendsScreenKey={friendsScreenKey}
        friends={fr.friends} pendingFriends={fr.pendingFriends} maxFriends={fr.maxFriends}
        friendUsername={fr.friendUsername} friendError={fr.friendError}
        friendsLoading={fr.friendsLoading} friendsLoadingUi={fr.friendsLoadingUi}
        friendProfile={friendProfile} friendProfileLoading={friendProfileLoading}
        friendProfileError={friendProfileError} friendProfileNotice={friendProfileNotice}
        onSetFriendsModalOpen={setFriendsModalOpen} onCloseFriendProfile={closeFriendsFriendProfile}
        onSetFriendUsername={fr.setFriendUsername} onSendFriendRequest={fr.sendFriendRequest}
        onAcceptFriend={fr.acceptFriend} onRejectFriend={fr.rejectFriend} onRemoveFriend={fr.removeFriend}
        onToggleFriendFavorite={fr.toggleFriendFavorite}
        onOpenFriendProfile={openFriendProfile} requestConfirm={confirm.requestConfirm}
        friendsModalRef={friendsModalRef} friendsScrollRef={friendsScrollRef}
      />

      <ConfirmDialog
        confirmData={confirm.confirmData} confirmPresence={confirmPresence} onResolve={confirm.resolveConfirm}
      />
    </div>
  )
}

export default App
