import { useState, useEffect } from 'react'
import { getInitials, formatDateTime } from '../utils'
import { TELEGRAM_CHANNEL_URL } from '../constants'

const CUSTOM_THEME_KEY = 'custom_theme_colors'

const DEFAULT_CUSTOM_COLORS = {
  bg_primary: '#0a0a0a',
  bg_secondary: '#141414',
  bg_card: '#1a1a1a',
  text_primary: '#ffffff',
  text_secondary: '#a0a0a0',
  accent: '#4ade80',
  border: '#2a2a2a',
  error: '#ef4444',
}

const COLOR_LABELS = {
  bg_primary: 'Фон',
  bg_secondary: 'Фон доп.',
  bg_card: 'Карточки',
  text_primary: 'Текст',
  text_secondary: 'Доп. текст',
  accent: 'Акцент',
  border: 'Бордер',
  error: 'Ошибки',
}

const THEME_PRESETS = [
  { name: 'Neon', colors: { bg_primary: '#0a0a0a', bg_secondary: '#141414', bg_card: '#1a1a1a', text_primary: '#ffffff', text_secondary: '#a0a0a0', accent: '#4ade80', border: '#2a2a2a', error: '#ef4444' } },
  { name: 'Rose', colors: { bg_primary: '#0f0a0c', bg_secondary: '#1a1215', bg_card: '#1e1518', text_primary: '#fff0f3', text_secondary: '#c9a0ab', accent: '#f472b6', border: '#3a2430', error: '#fb7185' } },
  { name: 'Лаванда', colors: { bg_primary: '#0e0b14', bg_secondary: '#151220', bg_card: '#1a1628', text_primary: '#f0eaff', text_secondary: '#a89bc8', accent: '#a78bfa', border: '#2e2548', error: '#f87171' } },
  { name: 'Океан', colors: { bg_primary: '#0a1018', bg_secondary: '#0f1820', bg_card: '#132030', text_primary: '#e8f4ff', text_secondary: '#88b4d8', accent: '#38bdf8', border: '#1e3a50', error: '#f97066' } },
  { name: 'Золото', colors: { bg_primary: '#0f0d08', bg_secondary: '#1a1610', bg_card: '#201c14', text_primary: '#fff8e8', text_secondary: '#c8b88a', accent: '#fbbf24', border: '#3a3220', error: '#ef4444' } },
  { name: 'Кибер', colors: { bg_primary: '#050510', bg_secondary: '#0a0a1a', bg_card: '#10102a', text_primary: '#e0e0ff', text_secondary: '#8888cc', accent: '#00ffaa', border: '#1a1a44', error: '#ff4466' } },
  { name: 'Свет', colors: { bg_primary: '#f5f5f5', bg_secondary: '#ffffff', bg_card: '#ffffff', text_primary: '#1a1a1a', text_secondary: '#666666', accent: '#2563eb', border: '#e0e0e0', error: '#dc2626' } },
  { name: 'Крем', colors: { bg_primary: '#faf5ef', bg_secondary: '#fff9f2', bg_card: '#fffbf5', text_primary: '#2c1810', text_secondary: '#8a7060', accent: '#d97706', border: '#e8ddd0', error: '#dc2626' } },
]

function loadCustomColors() {
  try {
    const raw = localStorage.getItem(CUSTOM_THEME_KEY)
    if (raw) return { ...DEFAULT_CUSTOM_COLORS, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_CUSTOM_COLORS }
}

function saveCustomColors(colors) {
  try { localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(colors)) } catch {}
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r}, ${g}, ${b}`
}

function blendColor(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const blend = (c, t, f) => Math.round(c + (t - c) * f)
  const nr = blend(r, 255, factor)
  const ng = blend(g, 255, factor)
  const nb = blend(b, 255, factor)
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
}

function darkenColor(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const nr = Math.round(r * (1 - factor))
  const ng = Math.round(g * (1 - factor))
  const nb = Math.round(b * (1 - factor))
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
}

export function applyCustomTheme(colors) {
  const root = document.documentElement
  root.style.setProperty('--bg-primary', colors.bg_primary)
  root.style.setProperty('--bg-secondary', colors.bg_secondary || blendColor(colors.bg_primary, 0.05))
  root.style.setProperty('--bg-card', colors.bg_card)
  root.style.setProperty('--text-primary', colors.text_primary)
  root.style.setProperty('--text-secondary', colors.text_secondary)
  root.style.setProperty('--text-muted', blendColor(colors.text_secondary, -0.3))
  root.style.setProperty('--accent', colors.accent)
  root.style.setProperty('--accent-hover', darkenColor(colors.accent, 0.15))
  root.style.setProperty('--accent-rgb', hexToRgb(colors.accent))
  root.style.setProperty('--accent-hover-rgb', hexToRgb(darkenColor(colors.accent, 0.15)))
  root.style.setProperty('--accent-text', blendColor(colors.accent, 0.3))
  root.style.setProperty('--accent-text-soft', blendColor(colors.accent, 0.55))
  root.style.setProperty('--accent-text-dim', blendColor(colors.accent, 0.7))
  root.style.setProperty('--accent-text-on', blendColor(colors.accent, 0.85))
  root.style.setProperty('--border', colors.border)
  root.style.setProperty('--error', colors.error || '#ef4444')
}

export function clearCustomTheme() {
  const props = [
    '--bg-primary', '--bg-secondary', '--bg-card',
    '--text-primary', '--text-secondary', '--text-muted',
    '--accent', '--accent-hover', '--accent-rgb', '--accent-hover-rgb',
    '--accent-text', '--accent-text-soft', '--accent-text-dim', '--accent-text-on',
    '--border', '--error'
  ]
  const root = document.documentElement
  props.forEach(p => root.style.removeProperty(p))
}

function CustomThemeEditor() {
  const [colors, setColors] = useState(loadCustomColors)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    applyCustomTheme(colors)
    saveCustomColors(colors)
  }, [colors])

  const handleChange = (key, value) => {
    setColors(prev => ({ ...prev, [key]: value }))
  }

  const applyPreset = (preset) => {
    setColors({ ...DEFAULT_CUSTOM_COLORS, ...preset.colors })
  }

  return (
    <div className="custom-theme-editor">
      <div className="custom-theme-presets">
        {THEME_PRESETS.map(preset => {
          const isActive = Object.keys(preset.colors).every(k => colors[k] === preset.colors[k])
          return (
            <button
              key={preset.name}
              type="button"
              className={`custom-theme-preset${isActive ? ' is-active' : ''}`}
              onClick={() => applyPreset(preset)}
            >
              <span
                className="custom-theme-preset-dot"
                style={{ background: `linear-gradient(135deg, ${preset.colors.bg_primary} 40%, ${preset.colors.accent})` }}
              />
              <span className="custom-theme-preset-name">{preset.name}</span>
            </button>
          )
        })}
      </div>

      <label className="custom-theme-accent-row">
        <span className="custom-theme-accent-label">Акцент</span>
        <input
          type="color"
          value={colors.accent}
          onChange={e => handleChange('accent', e.target.value)}
          className="custom-theme-color custom-theme-accent-picker"
        />
      </label>

      <button
        type="button"
        className="custom-theme-toggle-advanced"
        onClick={() => setShowAdvanced(v => !v)}
      >
        <span>Все цвета</span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {showAdvanced && (
        <div className="custom-theme-grid">
          {Object.keys(COLOR_LABELS).map(key => (
            <label key={key} className="custom-theme-field">
              <span className="custom-theme-label">{COLOR_LABELS[key]}</span>
              <div className="custom-theme-input-wrap">
                <input
                  type="color"
                  value={colors[key]}
                  onChange={e => handleChange(key, e.target.value)}
                  className="custom-theme-color"
                />
                <span className="custom-theme-hex">{colors[key]}</span>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

const CHEVRON = (
  <svg className="profile-menu-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 18l6-6-6-6"></path>
  </svg>
)

export default function ProfileSheet({
  sheetPresence, sheetStack, sheetNav,
  sheetScreenName, sheetParams, sheetScreenKey,
  sheetTitle, sheetSubtitle,
  // Profile data
  profileData, profileError, profileLoadingUi,
  profileSettings, connectionCheckLoading, connectionCheckResult,
  systemHealth, systemHealthLoading,
  isAuthorized, accountInfo, groupName, deleteLoading,
  // Friend profile
  friendProfile, friendProfileLoading, friendProfileError, friendProfileNotice,
  // Attendance info
  attendanceInfoPresence, onSetAttendanceInfoOpen,
  // Callbacks
  visibleTabs,
  onCloseSheet, onPopSheet, onPushSheet, sheetBodyRef, onUpdateProfileSettings, onOpenFriendsModal,
  onCheckProfileConnection, onRefreshSystemHealth,
  onLogout, onDeleteAccount,
  // Friends data (for button)
  friends, maxFriends,
  // Modals close helpers
  onSetConfirmOpen, onSetFriendsModalOpen,
  // Confirm
  requestConfirm
}) {
  if (!sheetPresence.shouldRender) return null

  const formatUptime = (seconds) => {
    const value = Number(seconds)
    if (!Number.isFinite(value) || value < 0) return '—'
    const total = Math.floor(value)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return `${h} ч ${m} мин`
    if (m > 0) return `${m} мин ${s} сек`
    return `${s} сек`
  }

  const healthChecked = formatDateTime(systemHealth?.checked_at)
  const authorized = profileData?.account?.authorized ?? isAuthorized

  return (
    <div
      className={`account-overlay ${sheetPresence.visible ? 'is-open' : ''}`}
      onClick={onCloseSheet}
    >
      <div className="account-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="account-header">
          <button
            className={`account-close sheet-back ${sheetStack.length > 1 ? '' : 'is-hidden'}`}
            type="button"
            onClick={onPopSheet}
            aria-label="Назад"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6"></path>
            </svg>
          </button>

          <div className="sheet-titles">
            <div className="account-title">{sheetTitle}</div>
            {sheetSubtitle && <div className="account-subtitle">{sheetSubtitle}</div>}
          </div>

          <button
            className="account-close"
            type="button"
            onClick={onCloseSheet}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="sheet-body" ref={sheetBodyRef}>
          <div
            className={`sheet-screen ${sheetNav === 'push' ? 'screen-push' : sheetNav === 'pop' ? 'screen-pop' : ''}`}
            key={sheetScreenKey}
          >

            {/* ===== MAIN PROFILE SCREEN ===== */}
            {sheetScreenName === 'profile' && (
              <>
                {profileError && (
                  <div className="status-message error profile-error">
                    <span className="status-icon">✕</span>
                    <span>{profileError}</span>
                  </div>
                )}

                <div className="profile-top">
                  <div className="profile-avatar">
                    {profileData?.telegram?.photo_url ? (
                      <img src={profileData.telegram.photo_url} alt="avatar" />
                    ) : (
                      <div className="profile-initials">
                        {getInitials(profileData?.telegram?.full_name || accountInfo?.user_name)}
                      </div>
                    )}
                  </div>
                  <div className="profile-meta">
                    <div className="profile-name">
                      {profileData?.telegram?.full_name || accountInfo?.user_name || '—'}
                    </div>
                    <div className="profile-id">
                      <span className={`profile-status-dot ${authorized ? 'is-on' : 'is-off'}`}></span>
                      {authorized ? 'МИРЭА подключен' : 'Не подключен'}
                    </div>
                  </div>
                </div>

                <button
                  className="profile-donate-btn"
                  type="button"
                  onClick={() => {
                    const tg = window.Telegram?.WebApp
                    const url = 'https://t.me/tribute/app?startapp=dFTX'
                    try {
                      if (tg?.openTelegramLink) tg.openTelegramLink(url)
                      else if (tg?.openLink) tg.openLink(url)
                      else window.open(url, '_blank', 'noopener,noreferrer')
                    } catch (e) {
                      try { window.open(url, '_blank', 'noopener,noreferrer') } catch {}
                    }
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                  </svg>
                  <span>Поддержать проект</span>
                </button>

                <div className="profile-overview-grid">
                  <div className="account-row is-compact">
                    <span className="account-label">Почта МИРЭА</span>
                    <span className="account-value">
                      {profileData?.account?.login || accountInfo?.login || 'Не указана'}
                    </span>
                  </div>
                  <div className="account-row is-compact">
                    <span className="account-label">Telegram</span>
                    <span className="account-value">
                      {(profileData?.telegram?.username || accountInfo?.telegram_username)
                        ? `@${profileData?.telegram?.username || accountInfo?.telegram_username}`
                        : '—'}
                    </span>
                  </div>
                  <div className="account-row is-compact profile-overview-wide">
                    <span className="account-label">Активная группа</span>
                    <span className="account-value">
                      {groupName
                        || localStorage.getItem('schedule_group')
                        || 'Не указана'}
                    </span>
                  </div>
                </div>

                <div className="profile-menu">
                  <button className="profile-menu-item" type="button" onClick={() => onPushSheet('history')}>
                    <svg className="profile-menu-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span>История отметок</span>
                    {CHEVRON}
                  </button>
                  <button className="profile-menu-item" type="button" onClick={() => onPushSheet('settings')}>
                    <svg className="profile-menu-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3"></circle>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                    <span>Настройки</span>
                    {CHEVRON}
                  </button>
                  <button className="profile-menu-item" type="button" onClick={() => onPushSheet('service')}>
                    <svg className="profile-menu-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
                    </svg>
                    <span>Состояние сервиса</span>
                    <span className={`profile-menu-badge ${systemHealth?.ok ? 'is-on' : 'is-off'}`}>
                      {systemHealth?.ok ? 'OK' : '!'}
                    </span>
                    {CHEVRON}
                  </button>
                  <button className="profile-menu-item" type="button" onClick={() => onPushSheet('privacy')}>
                    <svg className="profile-menu-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    </svg>
                    <span>Конфиденциальность</span>
                    {CHEVRON}
                  </button>
                </div>

                {isAuthorized && (
                  <>
                    <div className="profile-actions-grid">
                      <button
                        className="btn btn-primary account-friends-btn"
                        onClick={(e) => onOpenFriendsModal(e.currentTarget)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                          <circle cx="9" cy="7" r="4"></circle>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        Друзья ({friends.length}/{maxFriends})
                      </button>
                      <button
                        className="btn btn-secondary account-channel-btn"
                        type="button"
                        onClick={() => {
                          const tg = window.Telegram?.WebApp
                          try {
                            if (tg?.openTelegramLink) tg.openTelegramLink(TELEGRAM_CHANNEL_URL)
                            else if (tg?.openLink) tg.openLink(TELEGRAM_CHANNEL_URL)
                            else window.open(TELEGRAM_CHANNEL_URL, '_blank', 'noopener,noreferrer')
                          } catch (e) {
                            try { window.open(TELEGRAM_CHANNEL_URL, '_blank', 'noopener,noreferrer') } catch {}
                          }
                        }}
                        title="Перейти в Telegram-канал"
                        aria-label="Перейти в Telegram-канал"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                        </svg>
                        Telegram-канал
                      </button>
                    </div>
                    <button
                      className="btn btn-secondary account-logout"
                      onClick={() => {
                        (async () => {
                          const ok = await requestConfirm({
                            title: 'Выйти из аккаунта?',
                            message: 'Вы действительно хотите выйти из аккаунта МИРЭА? Чтобы пользоваться функциями снова, потребуется повторный вход.',
                            confirmText: 'Выйти',
                            cancelText: 'Отмена',
                            destructive: true
                          })
                          if (ok) await onLogout()
                        })()
                      }}
                    >
                      Выйти из аккаунта
                    </button>
                    <button
                      className="btn delete-account-btn"
                      disabled={deleteLoading}
                      onClick={() => {
                        (async () => {
                          const ok = await requestConfirm({
                            title: 'Удалить аккаунт?',
                            message: 'Все ваши данные будут безвозвратно удалены из базы данных: сессия, логи посещаемости, друзья, группа.',
                            confirmText: 'Удалить',
                            cancelText: 'Отмена',
                            destructive: true
                          })
                          if (ok) await onDeleteAccount()
                        })()
                      }}
                    >
                      {deleteLoading ? 'Удаляю...' : 'Удалить аккаунт'}
                    </button>
                    <p className="delete-account-hint">Все данные из базы данных будут удалены</p>
                  </>
                )}
              </>
            )}

            {/* ===== HISTORY SUB-SCREEN ===== */}
            {sheetScreenName === 'history' && (
              <>
                {profileData?.attendance_stats && (
                  <div className="profile-stats">
                    <div className="profile-stats-head">
                      <div className="profile-stats-title">Статистика</div>
                      <button
                        className="profile-stats-info"
                        type="button"
                        onClick={() => { onSetConfirmOpen(false); onSetFriendsModalOpen(false); onSetAttendanceInfoOpen(true) }}
                      >
                        Как это работает
                      </button>
                    </div>

                    <div className="profile-stats-grid">
                      <div className="stat-card">
                        <div className="stat-label">Всего</div>
                        <div className="stat-value">{profileData.attendance_stats.total_attempts}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Успешно</div>
                        <div className="stat-value">{profileData.attendance_stats.success_attempts}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Ошибки</div>
                        <div className="stat-value">{profileData.attendance_stats.failed_attempts}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Сегодня</div>
                        <div className="stat-value">{profileData.attendance_stats.today_success}/{profileData.attendance_stats.today_attempts}</div>
                      </div>
                    </div>

                    <div className="profile-stats-lines">
                      <div className="profile-stats-line">
                        <span>7 дней</span>
                        <span>{profileData.attendance_stats.success_7d}/{profileData.attendance_stats.attempts_7d} • {profileData.attendance_stats.success_rate_7d}%</span>
                      </div>
                      <div className="profile-stats-line">
                        <span>30 дней</span>
                        <span>{profileData.attendance_stats.success_30d}/{profileData.attendance_stats.attempts_30d} • успех {profileData.attendance_stats.success_rate_30d}%</span>
                      </div>
                      <div className="profile-stats-line">
                        <span>Ошибки 30 дней</span>
                        <span>{profileData.attendance_stats.failed_30d} • {profileData.attendance_stats.error_rate_30d}%</span>
                      </div>
                    </div>

                    <div className="profile-stats-foot">
                      <div>Последняя попытка: {formatDateTime(profileData.attendance_stats.last_attempt_at)}</div>
                      <div>Последний успех: {formatDateTime(profileData.attendance_stats.last_success_at)}</div>
                    </div>
                  </div>
                )}

                <div className="profile-section profile-history">
                  <div className="profile-section-head">
                    <div className="profile-section-title">Последние отметки</div>
                    <div className="profile-section-meta">10 попыток</div>
                  </div>
                  {(profileData?.recent_scans?.length || 0) === 0 ? (
                    <div className="dashboard-muted">Пока нет записей</div>
                  ) : (
                    <ul className="profile-history-list">
                      {(profileData?.recent_scans || []).map((item) => (
                        <li key={item.id || `${item.created_at}-${item.status}`} className="profile-history-item">
                          <div className="profile-history-top">
                            <span className="profile-history-time">{formatDateTime(item.created_at)}</span>
                            <span className={`history-status ${item.success ? 'is-success' : 'is-error'}`}>
                              {item.success ? 'Успех' : 'Ошибка'}
                            </span>
                          </div>
                          <div className="profile-history-message">{item.message || (item.success ? 'Отметка выполнена' : 'Ошибка')}</div>
                          <div className="profile-history-meta">Предмет: {item.subject || 'н/д от API'}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {/* ===== SETTINGS SUB-SCREEN ===== */}
            {sheetScreenName === 'settings' && (
              <>
                <div className="profile-section profile-settings">
                  <div className="profile-section-head">
                    <div className="profile-section-title">Тема</div>
                  </div>
                  <div className="theme-picker">
                    {[
                      { id: 'dark',  label: 'Тёмная',  swatch: 'swatch-dark' },
                      { id: 'light', label: 'Светлая', swatch: 'swatch-light' },
                      { id: 'ocean', label: 'Океан',   swatch: 'swatch-ocean' },
                      { id: 'custom', label: 'Своя',   swatch: 'swatch-custom' },
                    ].map(t => (
                      <div
                        key={t.id}
                        className={`theme-option${(profileSettings?.theme_mode || 'dark') === t.id ? ' is-active' : ''}`}
                        onClick={() => onUpdateProfileSettings({ theme_mode: t.id })}
                        role="button"
                        tabIndex={0}
                      >
                        <div className={`theme-swatch ${t.swatch}`} />
                        <span className="theme-option-label">{t.label}</span>
                      </div>
                    ))}
                  </div>
                  {(profileSettings?.theme_mode || 'dark') === 'custom' && (
                    <CustomThemeEditor />
                  )}
                </div>

                <div className="profile-section profile-settings">
                  <div className="profile-section-head">
                    <div className="profile-section-title">Доп. вкладки</div>
                  </div>
                  {[
                    { id: 'maps',     label: 'Карты' },
                    { id: 'esports',  label: 'Киберзона' },
                  ].map(tab => {
                    const isActive = visibleTabs?.includes(tab.id)
                    const atMax = (visibleTabs?.length || 0) >= 6
                    return (
                      <label key={tab.id} className="share-toggle">
                        <input
                          type="checkbox"
                          checked={!!isActive}
                          disabled={!isActive && atMax}
                          onChange={(e) => {
                            const current = visibleTabs || []
                            const next = e.target.checked
                              ? [...current, tab.id]
                              : current.filter(t => t !== tab.id)
                            onUpdateProfileSettings({ visible_tabs: next })
                          }}
                        />
                        <span>{tab.label}</span>
                      </label>
                    )
                  })}
                </div>

                <div className="profile-section profile-settings">
                  <div className="profile-section-head">
                    <div className="profile-section-title">Общие</div>
                  </div>
                  <label className="share-toggle">
                    <input
                      type="checkbox"
                      checked={!!profileSettings?.haptics_enabled}
                      onChange={(e) => onUpdateProfileSettings({ haptics_enabled: e.target.checked })}
                    />
                    <span>Вибрация</span>
                  </label>
                  {authorized && (
                    <>
                      <label className="share-toggle">
                        <input
                          type="checkbox"
                          checked={!!profileSettings?.mark_with_friends_default}
                          onChange={(e) => onUpdateProfileSettings({ mark_with_friends_default: e.target.checked })}
                        />
                        <span>Отмечаться вместе с друзьями</span>
                      </label>
                      {profileSettings?.mark_with_friends_default && (
                        <label className="share-toggle">
                          <input
                            type="checkbox"
                            checked={!!profileSettings?.auto_select_favorites}
                            onChange={(e) => onUpdateProfileSettings({ auto_select_favorites: e.target.checked })}
                          />
                          <span>Автовыбор избранных</span>
                        </label>
                      )}
                      {profileData?.account?.login && (
                        <label className="share-toggle">
                          <input
                            type="checkbox"
                            checked={!!profileSettings?.share_mirea_login}
                            onChange={(e) => onUpdateProfileSettings({ share_mirea_login: e.target.checked })}
                          />
                          <span>Показывать почту друзьям</span>
                        </label>
                      )}
                    </>
                  )}
                </div>

                {authorized && (
                  <div className="profile-section profile-connection">
                    <div className="profile-section-head">
                      <div className="profile-section-title">МИРЭА</div>
                      <button
                        type="button"
                        className="profile-action-link"
                        onClick={onCheckProfileConnection}
                        disabled={connectionCheckLoading}
                      >
                        {connectionCheckLoading ? 'Проверяю...' : 'Проверить'}
                      </button>
                    </div>
                    <div className="profile-section-body">
                      <div className="profile-kv-row">
                        <span className="account-label">Статус</span>
                        <span className={`sync-badge ${authorized ? 'is-on' : 'is-off'}`}>Подключен</span>
                      </div>
                      <div className="profile-kv-row">
                        <span className="account-label">Синхронизация</span>
                        <span className="account-value">{formatDateTime(profileData?.account?.last_sync_at)}</span>
                      </div>
                      {connectionCheckResult?.message && (
                        <div className={`profile-inline-note ${connectionCheckResult.ok ? 'is-ok' : 'is-error'}`}>
                          {connectionCheckResult.message}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ===== SERVICE SUB-SCREEN ===== */}
            {sheetScreenName === 'service' && (
              <div className="profile-section profile-reliability">
                <div className="profile-section-head">
                  <div className="profile-section-title">Состояние сервиса</div>
                  <button
                    type="button"
                    className="profile-action-link"
                    onClick={onRefreshSystemHealth}
                    disabled={systemHealthLoading}
                  >
                    {systemHealthLoading ? 'Обновляю...' : 'Обновить'}
                  </button>
                </div>
                <div className="profile-section-body">
                  <div className="profile-kv-row">
                    <span className="account-label">API health</span>
                    <span className={`sync-badge ${systemHealth?.ok ? 'is-on' : 'is-off'}`}>
                      {systemHealth?.ok ? 'OK' : 'Проблема'}
                    </span>
                  </div>
                  <div className="profile-kv-row">
                    <span className="account-label">Uptime API</span>
                    <span className="account-value">{formatUptime(systemHealth?.uptime_s)}</span>
                  </div>
                  <div className="profile-kv-row">
                    <span className="account-label">Обновлено</span>
                    <span className="account-value">{healthChecked}</span>
                  </div>
                  {!!systemHealth?.error && (
                    <div className="profile-inline-note is-error">
                      {systemHealth.error}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===== FRIEND PROFILE ===== */}
            {sheetScreenName === 'friendProfile' && (
              <FriendProfileContent
                friendProfile={friendProfile}
                friendProfileLoading={friendProfileLoading}
                friendProfileError={friendProfileError}
                friendProfileNotice={friendProfileNotice}
                preview={sheetParams?.preview}
              />
            )}

            {/* ===== PRIVACY POLICY ===== */}
            {sheetScreenName === 'privacy' && (
              <PrivacyPolicyContent />
            )}

          </div>

          {sheetScreenName === 'profile' && profileLoadingUi && (
            <div className="sheet-loading-overlay" aria-live="polite">
              <div className="status-message scanning scanning-indicator sheet-loading-pill">
                <span>Обновляю профиль...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {attendanceInfoPresence.shouldRender && (
        <div
          className={`sheet-modal-overlay ${attendanceInfoPresence.visible ? 'is-open' : ''}`}
          onClick={(e) => { e.stopPropagation(); onSetAttendanceInfoOpen(false) }}
        >
          <div className="sheet-modal info-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="account-header">
              <div className="sheet-titles">
                <div className="account-title">Как работает статистика</div>
                <div className="account-subtitle">Что именно мы считаем в профиле</div>
              </div>
              <button
                className="account-close"
                type="button"
                onClick={() => onSetAttendanceInfoOpen(false)}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>

            <div className="info-text">
              <p>Это не официальная ведомость МИРЭА. Здесь отображается статистика попыток отметки через этого бота.</p>
              <ul>
                <li>Запись добавляется, когда бот отправляет запрос на отметку посещаемости.</li>
                <li>Если отмечаете группу или друзей, попытки считаются отдельно для каждого человека.</li>
                <li>Успешно: запрос принят и бот получил ответ без ошибки.</li>
                <li>Ошибки: токен истёк, требуется авторизация, проблемы сети и т.п.</li>
                <li>QR токен не сохраняется. В лог попадает только обезличенная ссылка вида <code>?token=&lt;redacted&gt;</code>.</li>
                <li>«Сегодня» считается по времени Москвы.</li>
              </ul>
            </div>

            <button className="btn btn-secondary account-logout" onClick={() => onSetAttendanceInfoOpen(false)}>
              Понятно
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

function PrivacyPolicyContent() {
  return (
    <div className="privacy-policy">
      <p className="privacy-updated">Дата обновления: 12 апреля 2026 г.</p>

      <div className="privacy-section">
        <h3>1. Общие положения</h3>
        <p>MIREA Scanner — неофициальное приложение для студентов РТУ МИРЭА, работающее как Telegram Mini App. Приложение предоставляет удобный доступ к сервисам университета: отметка посещаемости, расписание, оценки БРС, пропуска СКУД, бронирование киберзоны.</p>
        <p>Используя приложение, вы соглашаетесь с условиями данной политики.</p>
      </div>

      <div className="privacy-section">
        <h3>2. Какие данные мы собираем</h3>

        <h4>Данные Telegram</h4>
        <ul>
          <li>Telegram ID, имя пользователя, полное имя</li>
          <li>URL фото профиля (не сохраняется на сервере)</li>
        </ul>

        <h4>Данные аккаунта МИРЭА</h4>
        <ul>
          <li>Email (логин) МИРЭА</li>
          <li>Сессионные токены для доступа к сервисам МИРЭА — хранятся в зашифрованном виде (AES/Fernet)</li>
          <li>Пароль НЕ сохраняется — используется только в момент авторизации</li>
        </ul>

        <h4>Логи посещаемости</h4>
        <ul>
          <li>Факт попытки отметки (успех/ошибка), дата и время</li>
          <li>QR-токен НЕ сохраняется в открытом виде</li>
        </ul>

        <h4>Друзья</h4>
        <ul>
          <li>Связи между пользователями (запрос/принято/отклонено)</li>
          <li>Статус избранного</li>
        </ul>

        <h4>Настройки</h4>
        <ul>
          <li>Предпочтения интерфейса: тема, тактильный отклик, видимые вкладки</li>
          <li>Настройки поведения: отметка с друзьями, автовыбор избранных, показ почты</li>
        </ul>
      </div>

      <div className="privacy-section">
        <h3>3. Какие данные мы НЕ собираем</h3>
        <ul>
          <li>Пароли от аккаунта МИРЭА</li>
          <li>Геолокацию</li>
          <li>Контакты, фото, файлы с устройства</li>
          <li>Данные других приложений</li>
          <li>Аналитику, рекламные идентификаторы</li>
        </ul>
      </div>

      <div className="privacy-section">
        <h3>4. Как мы используем данные</h3>
        <ul>
          <li>Авторизация в сервисах РТУ МИРЭА от вашего имени</li>
          <li>Отметка посещаемости по QR-коду</li>
          <li>Получение расписания, оценок, данных СКУД</li>
          <li>Управление списком друзей для совместной отметки</li>
          <li>Отображение статистики отметок в вашем профиле</li>
        </ul>
        <p>Мы не продаём, не передаём и не используем ваши данные в рекламных или коммерческих целях.</p>
      </div>

      <div className="privacy-section">
        <h3>5. Хранение и защита данных</h3>
        <ul>
          <li>Данные хранятся на защищённом сервере</li>
          <li>Сессии МИРЭА и токены киберзоны зашифрованы (Fernet/AES)</li>
          <li>Все запросы передаются по HTTPS</li>
          <li>Авторизация API через HMAC-подпись Telegram WebApp</li>
          <li>Применяется ограничение частоты запросов (rate limiting)</li>
        </ul>
      </div>

      <div className="privacy-section">
        <h3>6. Сторонние сервисы</h3>
        <p>Приложение взаимодействует со следующими сервисами РТУ МИРЭА:</p>
        <ul>
          <li><strong>sso.mirea.ru / login.mirea.ru</strong> — авторизация через Keycloak SSO</li>
          <li><strong>pulse.mirea.ru / attendance-app.mirea.ru</strong> — посещаемость, оценки, СКУД</li>
          <li><strong>esports.mirea.ru</strong> — бронирование киберзоны</li>
          <li><strong>app-api.mirea.ninja / english.mirea.ru</strong> — расписание (публичный API)</li>
        </ul>
        <p>Мы не контролируем политики конфиденциальности данных сервисов. Ваши учётные данные используются исключительно для доступа к ним от вашего имени.</p>
      </div>

      <div className="privacy-section">
        <h3>7. Ваши права</h3>
        <ul>
          <li><strong>Просмотр данных</strong> — вся хранимая информация доступна в вашем профиле</li>
          <li><strong>Удаление аккаунта</strong> — полное удаление всех данных из базы (профиль, логи, друзья) через кнопку «Удалить аккаунт»</li>
          <li><strong>Управление видимостью</strong> — вы можете скрыть почту от друзей в настройках</li>
          <li><strong>Выход</strong> — вы можете отключить привязку МИРЭА в любой момент</li>
        </ul>
      </div>

      <div className="privacy-section">
        <h3>8. Изменения политики</h3>
        <p>Мы можем обновлять данную политику. Актуальная версия всегда доступна в приложении. При существенных изменениях будет размещено уведомление в Telegram-канале.</p>
      </div>

      <div className="privacy-section">
        <h3>9. Контакты</h3>
        <p>По вопросам конфиденциальности и работы с данными обращайтесь через Telegram-канал приложения.</p>
      </div>
    </div>
  )
}

export function FriendProfileContent({ friendProfile, friendProfileLoading, friendProfileError, friendProfileNotice, preview }) {
  return (
    <>
      {friendProfileNotice && (
        <div className="status-message notice profile-notice">
          <span className="status-icon">i</span>
          <span>{friendProfileNotice}</span>
        </div>
      )}
      {friendProfileError && (
        <div className="status-message error profile-error">
          <span className="status-icon">✕</span>
          <span>{friendProfileError}</span>
        </div>
      )}

      {friendProfileLoading && (
        <div className="status-message scanning scanning-indicator profile-loading">
          <span>Загрузка профиля...</span>
        </div>
      )}

      {(friendProfile || preview) && (
        <div className="profile-top">
          <div className="profile-avatar">
            <div className="profile-initials">
              {getInitials(friendProfile?.name || preview?.name)}
            </div>
          </div>
          <div className="profile-meta">
            <div className="profile-name">{friendProfile?.name || preview?.name || '—'}</div>
            <div className="profile-id">
              {(friendProfile?.username || preview?.username)
                ? `@${friendProfile?.username || preview?.username}`
                : `ID: ${friendProfile?.id || preview?.id || '—'}`}
            </div>
          </div>
        </div>
      )}

      {friendProfile && !friendProfileLoading && (
        <>
          <div className="account-row">
            <span className="account-label">Почта МИРЭА</span>
            <span className="account-value">
              {friendProfile.login
                ? friendProfile.login
                : (friendProfile.login_shared ? 'Не указана' : 'Скрыто')}
            </span>
          </div>
          {!friendProfile.login && !friendProfile.login_shared && (
            <div className="friend-profile-hint">Друг выключил показ почты в настройках профиля</div>
          )}

          <div className="account-row">
            <span className="account-label">Статус</span>
            <span className="account-value">{friendProfile.authorized ? 'Авторизован' : 'Не авторизован'}</span>
          </div>
        </>
      )}
    </>
  )
}
