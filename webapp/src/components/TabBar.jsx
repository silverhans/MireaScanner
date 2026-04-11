import { useRef, useEffect } from 'react'

/* Outline icons (inactive state) — SF Symbols style with rounded joins */
const TAB_ICONS = {
  scanner: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l2-2 7-7 7 7 2 2" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  ),
  schedule: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  maps: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </svg>
  ),
  passes: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 9h10" />
      <path d="M7 13h5" />
    </svg>
  ),
  grades: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  ),
  esports: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M7 10v4M5 12h4" />
      <circle cx="17" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
}

/* Filled icons (active state) — SF Symbols .fill style */
const TAB_ICONS_FILLED = {
  scanner: (
    <svg width="22" height="22" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l2-2 7-7 7 7 2 2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7l-7-7-7 7z" fill="currentColor" stroke="none" />
    </svg>
  ),
  schedule: (
    <svg width="22" height="22" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="currentColor" stroke="none" />
      <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="1.8" />
      <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="1.8" />
      <rect x="6" y="12" width="3" height="2.5" rx="0.5" fill="var(--bg-primary)" />
      <rect x="10.5" y="12" width="3" height="2.5" rx="0.5" fill="var(--bg-primary)" />
      <rect x="15" y="12" width="3" height="2.5" rx="0.5" fill="var(--bg-primary)" />
      <rect x="6" y="16.5" width="3" height="2.5" rx="0.5" fill="var(--bg-primary)" />
      <rect x="10.5" y="16.5" width="3" height="2.5" rx="0.5" fill="var(--bg-primary)" />
    </svg>
  ),
  maps: (
    <svg width="22" height="22" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="currentColor" stroke="none" />
      <path d="M9 4v14" stroke="var(--bg-primary)" strokeWidth="1.5" fill="none" />
      <path d="M15 6v14" stroke="var(--bg-primary)" strokeWidth="1.5" fill="none" />
    </svg>
  ),
  passes: (
    <svg width="22" height="22" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="currentColor" stroke="none" />
      <path d="M7 9h10" stroke="var(--bg-primary)" strokeWidth="1.8" fill="none" />
      <path d="M7 13h5" stroke="var(--bg-primary)" strokeWidth="1.8" fill="none" />
    </svg>
  ),
  grades: (
    <svg width="22" height="22" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 10l10-5 10 5-10 5z" fill="currentColor" stroke="none" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" fill="currentColor" stroke="none" opacity="0.7" />
      <path d="M22 10v6" stroke="currentColor" strokeWidth="1.8" fill="none" />
    </svg>
  ),
  esports: (
    <svg width="22" height="22" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" fill="currentColor" stroke="none" />
      <path d="M7 10v4M5 12h4" stroke="var(--bg-primary)" strokeWidth="1.8" fill="none" />
      <circle cx="17" cy="10" r="1.2" fill="var(--bg-primary)" />
      <circle cx="15" cy="13" r="1.2" fill="var(--bg-primary)" />
    </svg>
  ),
}

const TAB_LABELS = {
  scanner: 'Главная',
  schedule: 'Пары',
  maps: 'Карты',
  passes: 'Пропуск',
  grades: 'БРС',
  esports: 'Кибер',
}

export default function TabBar({ activeTab, onTabChange, tabs }) {
  const activeTabIndex = Math.max(0, tabs.indexOf(activeTab))
  const tabsRef = useRef(null)
  const meta = useRef({})
  meta.current = { tabs, activeTab, activeTabIndex, onTabChange }

  useEffect(() => {
    const el = tabsRef.current
    if (!el) return

    let dragging = false
    let decided = false
    let isDrag = false
    let startX = 0
    let startY = 0
    let lastFrac = null
    let lastNearest = -1
    let hadVerticalSwipes = false

    const onTouchStart = (e) => {
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      dragging = true
      decided = false
      isDrag = false
      lastFrac = null
      lastNearest = -1

      const wa = window.Telegram?.WebApp
      hadVerticalSwipes = wa?.isVerticalSwipesEnabled !== false
      if (hadVerticalSwipes) try { wa?.disableVerticalSwipes?.() } catch {}
    }

    const onTouchMove = (e) => {
      e.preventDefault()
      if (!dragging) return
      const touch = e.touches[0]

      if (!decided) {
        const dx = Math.abs(touch.clientX - startX)
        const dy = Math.abs(touch.clientY - startY)
        if (dx < 8 && dy < 8) return
        decided = true
        isDrag = dx > dy
        if (!isDrag) { dragging = false; return }
        el.classList.add('is-dragging')
      }

      if (!isDrag) return

      const { tabs: t } = meta.current
      const rect = el.getBoundingClientRect()
      const pad = 4
      const innerW = rect.width - pad * 2
      const tabW = innerW / t.length
      const relX = touch.clientX - rect.left - pad
      const frac = Math.max(0, Math.min(t.length - 1, relX / tabW - 0.5))
      lastFrac = frac
      el.style.setProperty('--active-index', frac.toFixed(3))

      const nearest = Math.round(frac)
      if (nearest !== lastNearest) {
        if (lastNearest >= 0) el.children[lastNearest + 1]?.classList.remove('drag-target')
        el.children[nearest + 1]?.classList.add('drag-target')
        lastNearest = nearest
        try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged() } catch {}
      }
    }

    const onTouchEnd = () => {
      if (hadVerticalSwipes) {
        try { window.Telegram?.WebApp?.enableVerticalSwipes?.() } catch {}
        hadVerticalSwipes = false
      }

      if (!dragging) return
      const wasDrag = isDrag
      dragging = false
      decided = false
      isDrag = false

      if (!wasDrag) return

      el.querySelectorAll('.drag-target').forEach(t => t.classList.remove('drag-target'))
      el.classList.remove('is-dragging')

      const { tabs: t, activeTab: current, activeTabIndex: curIdx, onTabChange: onChange } = meta.current

      if (lastFrac !== null) {
        const snapped = Math.max(0, Math.min(t.length - 1, Math.round(lastFrac)))
        const tabId = t[snapped]
        if (tabId && tabId !== current) {
          onChange(tabId)
        } else {
          el.style.setProperty('--active-index', String(curIdx))
        }
      }
      lastFrac = null
      lastNearest = -1
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  return (
    <div
      className="tabs"
      ref={tabsRef}
      style={{
        '--tab-count': String(tabs.length),
        '--active-index': String(activeTabIndex)
      }}
    >
      <div className="tab-indicator" aria-hidden="true"></div>
      {tabs.map(id => (
        <button
          key={id}
          className={`tab ${activeTab === id ? 'active' : ''}`}
          onClick={() => onTabChange(id)}
        >
          {activeTab === id ? TAB_ICONS_FILLED[id] : TAB_ICONS[id]}
          <span>{TAB_LABELS[id]}</span>
        </button>
      ))}
    </div>
  )
}
