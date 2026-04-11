import { useState } from 'react'
import { fmtPoints } from '../utils'

const gradeBadgeForTotal = (value) => {
  const total = Number(value)
  if (!Number.isFinite(total)) return null
  if (total >= 40) return { text: 'Зачёт', cls: 'grade-зачтено' }
  return { text: 'Незачёт', cls: 'grade-незачтено' }
}

const fmtPointsWithMax = (value, max) => `${fmtPoints(value)} / ${max}`
const MAX_ATTENDANCE = 30

const toNumber = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

const getProjectedAttendance = (subject) => {
  const maxPossible = Number(subject?.attendance_max_possible)
  const currentAttendance = Number(subject?.attendance)
  const current = Number.isFinite(currentAttendance) ? currentAttendance : 0

  if (
    Number.isFinite(maxPossible)
    && maxPossible > 0
    && maxPossible <= MAX_ATTENDANCE
    && maxPossible + 1e-6 >= current
  ) {
    return Math.min(MAX_ATTENDANCE, maxPossible)
  }
  // Если бекенд не смог надежно посчитать прогноз, не показываем ложные 30/30.
  return Math.min(MAX_ATTENDANCE, Math.max(0, current))
}

const projectedTotalWithIdealAttendance = (subject) => {
  const currentControl = toNumber(subject.current_control)
  const semesterControl = toNumber(subject.semester_control)
  const attendance = getProjectedAttendance(subject)
  const achievements = toNumber(subject.achievements)
  const additional = toNumber(subject.additional)
  return currentControl + semesterControl + attendance + achievements + additional
}

const ATTEND_LABELS = { 0: 'Н/Д', 1: 'Нет', 2: 'Уваж.', 3: 'Да' }
const ATTEND_CLS = { 0: 'unknown', 1: 'absent', 2: 'excused', 3: 'present' }

const formatLessonDate = (epoch) => {
  if (!epoch) return '—'
  const d = new Date(epoch * 1000)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' +
    d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function AttendanceDetail({ detail }) {
  if (!detail) return null
  if (detail.loading) {
    return (
      <div className="attendance-detail-loading">
        <span>Загрузка посещений...</span>
      </div>
    )
  }
  if (detail.error) {
    return <div className="attendance-detail-error">{detail.error}</div>
  }
  if (!detail.data) return null

  const { summary, entries } = detail.data
  const sorted = [...(entries || [])].sort((a, b) => (a.lesson_start || 0) - (b.lesson_start || 0))

  return (
    <div className="attendance-detail" onClick={(e) => e.stopPropagation()}>
      {summary && summary.total > 0 && (
        <div className="attendance-summary">
          <div className="attendance-summary-item present">{summary.present} присут.</div>
          <div className="attendance-summary-item excused">{summary.excused} уваж.</div>
          <div className="attendance-summary-item absent">{summary.absent} пропуск.</div>
          <div className="attendance-summary-item total">{summary.total} всего</div>
        </div>
      )}
      {sorted.length > 0 && (
        <div className="attendance-entries">
          {sorted.map((entry, i) => (
            <div key={i} className={`attendance-entry ${ATTEND_CLS[entry.attend_type] || 'unknown'}`}>
              <span className="attendance-entry-date">{formatLessonDate(entry.lesson_start)}</span>
              <span className={`attendance-entry-badge ${ATTEND_CLS[entry.attend_type] || 'unknown'}`}>
                {ATTEND_LABELS[entry.attend_type] ?? '—'}
              </span>
            </div>
          ))}
        </div>
      )}
      {sorted.length === 0 && summary && summary.total > 0 && (
        <div className="attendance-detail-loading">Нет детальных данных по занятиям</div>
      )}
    </div>
  )
}

export default function GradesTab({ gradesData, gradesLoading, gradesError, onRefresh, tabDirection, attendanceDetail, onLoadAttendanceDetail }) {
  const [idealAttendanceMode, setIdealAttendanceMode] = useState(false)
  const [expandedSubject, setExpandedSubject] = useState(null)
  const subjects = Array.isArray(gradesData?.subjects) ? gradesData.subjects : []
  const average = subjects.length > 0
    ? subjects.reduce(
      (acc, s) => acc + (idealAttendanceMode ? projectedTotalWithIdealAttendance(s) : Number(s.total || 0)),
      0
    ) / subjects.length
    : null

  return (
    <div className={`grades-section tab-pane ${tabDirection}`}>
      <div className="grades-shell">
        <div className="grades-header">
          <div>
            <div className="grades-title">Баллы БРС</div>
            <div className="grades-subtitle">Текущая успеваемость по дисциплинам</div>
          </div>
        </div>

        {!gradesLoading && !gradesError && subjects.length > 0 && (
          <div className="grades-hero">
            <div className="grades-hero-label">{idealAttendanceMode ? 'Режим прогноза' : 'Фактические данные'}</div>
            <div className="grades-hero-main">
              <div className="grades-hero-item">
                <div className="grades-hero-value">{subjects.length}</div>
                <div className="grades-hero-caption">Предметов</div>
              </div>
              <div className="grades-hero-item">
                <div className="grades-hero-value">{average == null ? '—' : fmtPoints(average)}</div>
                <div className="grades-hero-caption">{idealAttendanceMode ? 'Средний прогноз' : 'Средний балл'}</div>
              </div>
            </div>
            {idealAttendanceMode && (
              <div className="grades-projection-hint">
                Прогноз учитывает максимум посещаемости. Если API уже учитывает пропуски, лимит будет ниже 30.
              </div>
            )}
          </div>
        )}

        <div className="grades-header-actions">
          <button
            className={`btn btn-secondary grades-mode-toggle ${idealAttendanceMode ? 'is-active' : ''}`}
            onClick={() => setIdealAttendanceMode((prev) => !prev)}
            disabled={gradesLoading}
            title="Показать прогноз, если посещаемость будет 30/30"
          >
            {idealAttendanceMode ? 'Фактические баллы' : 'Идеальная посещаемость'}
          </button>
          <button
            className="btn btn-secondary grades-refresh"
            onClick={onRefresh}
            disabled={gradesLoading}
          >
            {gradesLoading ? 'Загрузка...' : 'Обновить'}
          </button>
        </div>

        {gradesLoading && (
          <div className="status-message scanning scanning-indicator">
            <span>Загрузка баллов...</span>
          </div>
        )}

        {!gradesLoading && gradesError && (
          <div className="status-message error">
            <span className="status-icon">✕</span>
            <span>{gradesError}</span>
          </div>
        )}

        {!gradesLoading && !gradesError && subjects.length > 0 && (
          <>
            <div className="grades-list">
              {subjects.map((subject) => {
                const shownTotal = idealAttendanceMode
                  ? projectedTotalWithIdealAttendance(subject)
                  : subject.total
                const projectedAttendance = getProjectedAttendance(subject)
                const shownAttendance = idealAttendanceMode ? projectedAttendance : subject.attendance
                const badge = gradeBadgeForTotal(shownTotal)
                const did = subject.discipline_id
                const isExpanded = expandedSubject === did && did
                const handleCardClick = () => {
                  if (!did) return
                  if (expandedSubject === did) {
                    setExpandedSubject(null)
                    return
                  }
                  setExpandedSubject(did)
                  const cached = attendanceDetail?.detailCache?.[did]
                  if (!cached?.data && !cached?.loading) {
                    onLoadAttendanceDetail?.(did, gradesData?.semester)
                  }
                }
                return (
                  <div
                    key={subject.name}
                    className={`grade-card ${did ? 'tappable' : ''} ${isExpanded ? 'expanded' : ''}`}
                    onClick={handleCardClick}
                  >
                    {badge && (
                      <div className={`grade-badge ${badge.cls}`}>
                        {badge.text}
                      </div>
                    )}
                    <div className="grade-subject">
                      {subject.name}
                      {did && (
                        <svg className={`grade-expand-icon ${isExpanded ? 'is-open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M6 9l6 6 6-6"></path>
                        </svg>
                      )}
                    </div>

                    <div className="grade-rows">
                      <div className="grade-row">
                        <span className="grade-label">Текущий контроль</span>
                        <span className="grade-value">{fmtPointsWithMax(subject.current_control, 40)}</span>
                      </div>
                      <div className="grade-row">
                        <span className="grade-label">Семестровый контроль</span>
                        <span className="grade-value">{fmtPointsWithMax(subject.semester_control, 30)}</span>
                      </div>
                      <div className="grade-row">
                        <span className="grade-label">Посещения</span>
                        <span className="grade-value">{fmtPointsWithMax(shownAttendance, 30)}</span>
                      </div>
                      <div className="grade-row">
                        <span className="grade-label">Достижения</span>
                        <span className="grade-value">{fmtPointsWithMax(subject.achievements, 10)}</span>
                      </div>
                      <div className="grade-row">
                        <span className="grade-label">Дополнительные</span>
                        <span className="grade-value">{fmtPointsWithMax(subject.additional, 10)}</span>
                      </div>

                      <div className={`grade-row grade-total ${Number(shownTotal) < 40 ? 'grade-fail' : ''}`}>
                        <span className="grade-label">{idealAttendanceMode ? 'Итого (прогноз)' : 'Итого'}</span>
                        <span className="grade-value">{fmtPoints(shownTotal)}</span>
                      </div>
                      {idealAttendanceMode && projectedAttendance < MAX_ATTENDANCE && (
                        <div className="grade-note">
                          С учетом прошлых пропусков максимум по посещаемости: {fmtPoints(projectedAttendance)} / 30
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <AttendanceDetail detail={attendanceDetail?.detailCache?.[did]} />
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!gradesLoading && !gradesError && subjects.length === 0 && (
          <div className="empty-state">
            <p>Нет данных. Авторизуйтесь заново и нажмите «Обновить».</p>
            <p className="empty-state-hint">Оценки берутся из системы БРС МИРЭА (Pulse).</p>
          </div>
        )}
      </div>
    </div>
  )
}
