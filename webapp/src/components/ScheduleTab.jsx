import { formatClock, formatMoscowDate, getLocalDayKey } from '../utils'

function formatLessonCount(value) {
  const count = Number(value) || 0
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} пара`
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return `${count} пары`
  return `${count} пар`
}

export default function ScheduleTab({
  tabDirection,
  // Computed schedule data
  scheduleTabLoading, scheduleTabError, scheduleTabEvents,
  scheduleTabResolvedName,
  // View
  scheduleViewMode, onSetScheduleViewMode, onSetScheduleFocusDate,
  onShiftScheduleFocus, formatScheduleRange,
  // Parsed
  scheduleDisplayKeys, scheduleByDayKey
}) {
  const todayDayKey = getLocalDayKey(new Date())
  const todayLessonsCount = Array.isArray(scheduleByDayKey?.[todayDayKey])
    ? scheduleByDayKey[todayDayKey].length
    : 0
  const hasScheduleResults = !scheduleTabLoading && scheduleTabEvents.length > 0

  const scheduleHeroBlock = !scheduleTabLoading && !scheduleTabError && scheduleTabEvents.length > 0 ? (
    <div className="schedule-hero">
      <div className="schedule-hero-label">{scheduleTabResolvedName || 'Расписание'}</div>
      <div className="schedule-hero-main">
        <div className="schedule-hero-left">
          <div className="schedule-hero-name">Сегодня</div>
          <div className="schedule-hero-sub">{formatLessonCount(todayLessonsCount)}</div>
        </div>
      </div>
    </div>
  ) : null

  const scheduleResultsBlock = hasScheduleResults ? (
    <div className="schedule-results-card">
      <div className="schedule-toolbar">
        <div className="schedule-toolbar-left">
          <div className="schedule-view">
            <button
              type="button"
              className={`schedule-pill ${scheduleViewMode === 'day' ? 'active' : ''}`}
              onClick={() => onSetScheduleViewMode('day')}
            >
              День
            </button>
            <button
              type="button"
              className={`schedule-pill ${scheduleViewMode === 'week' ? 'active' : ''}`}
              onClick={() => onSetScheduleViewMode('week')}
            >
              Неделя
            </button>
          </div>

          <div className="schedule-nav">
            <button
              type="button"
              className="schedule-icon-btn"
              onClick={() => onShiftScheduleFocus(scheduleViewMode === 'day' ? -1 : -7)}
              aria-label="Назад"
            >
              &#8249;
            </button>
            <div className="schedule-range">{formatScheduleRange}</div>
            <button
              type="button"
              className="schedule-icon-btn"
              onClick={() => onShiftScheduleFocus(scheduleViewMode === 'day' ? 1 : 7)}
              aria-label="Вперёд"
            >
              &#8250;
            </button>
            <button
              type="button"
              className="schedule-pill"
              onClick={() => onSetScheduleFocusDate(new Date())}
            >
              Сегодня
            </button>
          </div>
        </div>
      </div>

      <div className="schedule-list">
        {scheduleDisplayKeys.map((dayKey) => {
          const events = scheduleByDayKey[dayKey] || []
          const dateObj = new Date(`${dayKey}T00:00:00+03:00`)
          const dateLabel = Number.isNaN(dateObj.getTime())
            ? dayKey
            : formatMoscowDate(dateObj, {
              weekday: 'short',
              day: '2-digit',
              month: 'short'
            })

          if (scheduleViewMode === 'week' && events.length === 0) return null

          return (
            <div key={dayKey} className="schedule-day">
              <div className="schedule-day-head">
                <div className="schedule-date">{dateLabel}</div>
                <div className="schedule-day-count">{formatLessonCount(events.length)}</div>
              </div>
              <div className="schedule-cards">
                {events.length === 0 && (
                  <div className="schedule-empty-day">Нет занятий</div>
                )}
                {events.map((event, idx) => {
                  const time = `${formatClock(event._start)}` +
                    `${event._end ? `–${formatClock(event._end)}` : ''}`
                  return (
                    <div key={`${dayKey}-${idx}`} className="schedule-card">
                      <div className="schedule-time">{time}</div>
                      <div className="schedule-title">{event.summary || 'Занятие'}</div>
                      {event.location && (
                        <div className="schedule-location">{event.location}</div>
                      )}
                      {event.description && (
                        <div className="schedule-description">{event.description}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  ) : null

  return (
    <div className={`schedule-section tab-pane ${tabDirection}`}>
      {scheduleHeroBlock}
      {scheduleResultsBlock}

      {scheduleTabError && !scheduleTabLoading && (
        <div className="status-message error">
          <span className="status-icon">&#10005;</span>
          <span>{scheduleTabError}</span>
        </div>
      )}

      {scheduleTabLoading && (
        <div className="status-message scanning scanning-indicator">
          <span>Загрузка расписания...</span>
        </div>
      )}

      {!scheduleTabLoading && !scheduleTabError && scheduleTabEvents.length === 0 && (
        <div className="empty-state">
          <p>Подключи МИРЭА аккаунт, чтобы увидеть расписание.</p>
        </div>
      )}
    </div>
  )
}
