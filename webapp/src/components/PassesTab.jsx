function formatPassCount(value) {
  const count = Number(value) || 0
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} проход`
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return `${count} прохода`
  return `${count} проходов`
}

export default function PassesTab({ acsEvents, acsLoading, acsError, onRefresh, tabDirection }) {
  const events = Array.isArray(acsEvents) ? acsEvents : []
  const latestEvent = events.length > 0 ? events[0] : null

  return (
    <div className={`passes-section tab-pane ${tabDirection}`}>
      <div className="passes-card">
        <div className="passes-header">
          <div>
            <div className="passes-title">Мой пропуск</div>
            <div className="passes-subtitle">События СКУД за сегодня</div>
          </div>
          <button
            className="btn btn-secondary btn-compact"
            onClick={onRefresh}
            disabled={acsLoading}
          >
            {acsLoading ? '...' : 'Обновить'}
          </button>
        </div>

        {acsLoading && (
          <div className="status-message scanning scanning-indicator">
            <span>Загрузка событий...</span>
          </div>
        )}

        {!acsLoading && acsError && (
          <div className="status-message error">
            <span className="status-icon">✕</span>
            <span>{acsError}</span>
          </div>
        )}

        {!acsLoading && !acsError && events.length === 0 && (
          <div className="empty-state">
            <p>Нет проходов за сегодня.</p>
          </div>
        )}

        {!acsLoading && !acsError && events.length > 0 && (
          <div className="passes-wrap">
            <div className="passes-hero">
              <div className="passes-hero-label">Сегодня</div>
              <div className="passes-hero-main">
                <div className="passes-hero-left">
                  <div className="passes-hero-count">{formatPassCount(events.length)}</div>
                  <div className="passes-hero-sub">
                    {latestEvent ? `Последний проход: ${latestEvent.time || '—'}` : 'Последних событий нет'}
                  </div>
                </div>
                <div className="passes-hero-time">{latestEvent?.time || '--:--'}</div>
              </div>
            </div>

            <div className="passes-list">
              {events.map((event, idx) => (
                <div className="passes-item" key={`${event.ts || idx}-${idx}`}>
                  <div className="passes-item-top">
                    <div className="passes-time-wrap">
                      <span className="passes-dot" aria-hidden="true" />
                      <span className="passes-time">{event.time || '—'}</span>
                    </div>
                    <span className="passes-duration-badge">{event.duration || '—'}</span>
                  </div>
                  <div className="passes-route">
                    <span className="passes-zone">{event.enter_zone || '—'}</span>
                    <span className="passes-arrow">→</span>
                    <span className="passes-zone">{event.exit_zone || '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
