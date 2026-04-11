import { useState, useEffect, useMemo } from 'react'

const CATEGORIES = [
  { slug: 'all', name: 'Все' },
  { slug: 'pc', name: 'Компьютеры' },
  { slug: 'console', name: 'Консоли' },
  { slug: 'vr', name: 'VR' },
  { slug: 'auto-sim', name: 'Автосимулятор' },
  { slug: 'billiard', name: 'Бильярд' },
]

const DURATIONS = [
  { value: 30, label: '30 мин' },
  { value: 60, label: '1 час' },
  { value: 90, label: '1.5 часа' },
  { value: 120, label: '2 часа' },
  { value: 180, label: '3 часа' },
]

const ERROR_MESSAGES = {
  TIMESLOT_NOT_AVAILABLE: 'Таймслот недоступен',
  BOOKING_DATE_NOT_AVAILABLE: 'На выбранный день нет доступных бронирований',
  NOT_WORKING_DAY: 'Не рабочий день',
  INVALID_DURATION: 'Некорректная длительность',
  INVALID_CATEGORY: 'Некорректная категория',
  BOOKING_TIME_NOT_VALID: 'Некорректное время бронирования',
  BOOKING_LIMIT_EXCEEDED: 'Превышен лимит бронирований',
  DEVICE_NOT_FOUND: 'Устройство не найдено',
  BOOKING_NOT_FOUND: 'Бронирование не найдено',
  BOOKING_ALREADY_CANCELLED: 'Бронирование уже отменено',
  CANT_GET_TIMESLOTS_TODAY: 'Невозможно получить слоты на сегодня',
}

function translateError(msg) {
  if (!msg) return 'Неизвестная ошибка'
  return ERROR_MESSAGES[msg] || msg
}

function extractDateFromISO(isoStr) {
  const m = isoStr.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function extractHourFromISO(isoStr) {
  const m = isoStr.match(/T(\d{2}):/)
  return m ? parseInt(m[1], 10) : null
}

function formatDateLabel(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })
}

function formatConfigDate(isoStr) {
  const dateStr = extractDateFromISO(isoStr)
  if (!dateStr) return null
  return { value: dateStr, label: formatDateLabel(dateStr) }
}

function formatBookingDate(dateStr) {
  if (!dateStr) return ''
  const plain = dateStr.length > 10 ? extractDateFromISO(dateStr) || dateStr : dateStr
  const [y, m, d] = plain.split('-').map(Number)
  if (!y) return dateStr
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })
}

function generateTimeOptions(fromHour, toHour) {
  const opts = []
  for (let h = fromHour; h < toHour; h++) {
    opts.push({ value: `${String(h).padStart(2, '0')}:00`, label: `${h}:00` })
    if (h + 0.5 < toHour) {
      opts.push({ value: `${String(h).padStart(2, '0')}:30`, label: `${h}:30` })
    }
  }
  return opts
}

function buildBookingDatetime(date, time) {
  return `${date}T${time}+03:00`
}

function durationLabel(mins) {
  if (mins >= 60) return `${mins / 60} ч`
  return `${mins} мин`
}

// ── Login screen ─────────────────────────────────────────────────

function EsportsLogin({ onLogin, loading, error }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (email.trim() && password.trim()) {
      onLogin(email.trim(), password.trim())
    }
  }

  return (
    <div className="esports-login">
      <div className="esports-login-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M6 12h.01M10 12h.01" />
          <path d="M14 10l2 2-2 2" />
          <path d="M18 10v4" />
        </svg>
      </div>
      <div className="esports-login-title">Киберзона МИРЭА</div>
      <div className="esports-login-subtitle">Войдите с учётной записью МИРЭА для бронирования мест</div>
      <form className="esports-login-form" onSubmit={handleSubmit}>
        <input
          type="email"
          className="esports-input"
          placeholder="Email МИРЭА"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          disabled={loading}
        />
        <input
          type="password"
          className="esports-input"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={loading}
        />
        {error && <div className="esports-login-error">{error}</div>}
        <button type="submit" className="btn btn-primary esports-login-btn" disabled={loading || !email.trim() || !password.trim()}>
          {loading ? 'Вход...' : 'Войти'}
        </button>
      </form>
    </div>
  )
}

// ── Booking flow ─────────────────────────────────────────────────

function BookingFlow({ esports, requestConfirm }) {
  const [screen, setScreen] = useState('main') // main | slots | bookings
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [selectedDuration, setSelectedDuration] = useState(60)

  const { dateOptions, timeOptions } = useMemo(() => {
    const cfg = esports.config
    if (!cfg) return { dateOptions: [], timeOptions: [] }

    const days = cfg.days || []
    const dates = days.map(formatConfigDate).filter(Boolean)

    let fromH = 9, toH = 20
    if (cfg.work_time_from) {
      const h = extractHourFromISO(cfg.work_time_from)
      if (h !== null) fromH = h
    }
    if (cfg.work_time_to) {
      const h = extractHourFromISO(cfg.work_time_to)
      if (h !== null) toH = h
    }

    return { dateOptions: dates, timeOptions: generateTimeOptions(fromH, toH) }
  }, [esports.config])

  useEffect(() => {
    if (!esports.config && !esports.configLoading) {
      esports.loadConfig()
    }
  }, [])

  useEffect(() => {
    if (dateOptions.length > 0 && !selectedDate) {
      setSelectedDate(dateOptions[0].value)
    }
  }, [dateOptions])

  useEffect(() => {
    if (timeOptions.length > 0 && !selectedTime) {
      setSelectedTime(timeOptions[0].value)
    }
  }, [timeOptions])

  const searchParams = useMemo(() => ({
    date: selectedDate,
    duration: selectedDuration,
    start_time: selectedTime,
    category: selectedCategory,
  }), [selectedDate, selectedDuration, selectedTime, selectedCategory])

  const handleSearch = () => {
    if (!selectedDate || !selectedTime) return
    esports.loadSlots(searchParams)
    setScreen('slots')
  }

  const handleBook = async (device_id, deviceName, timeslotStartTime, timeslotEndTime) => {
    const timeLabel = timeslotStartTime.slice(0, 5) + (timeslotEndTime ? `–${timeslotEndTime.slice(0, 5)}` : '')
    const confirmed = await requestConfirm({
      title: 'Забронировать?',
      message: `${deviceName} · ${formatBookingDate(selectedDate)} · ${timeLabel} · ${durationLabel(selectedDuration)}`,
      confirmText: 'Забронировать',
      cancelText: 'Отмена',
    })
    if (!confirmed) return

    const booking_datetime = buildBookingDatetime(selectedDate, timeslotStartTime)
    const ok = await esports.book({
      device_id,
      booking_datetime,
      booking_duration: selectedDuration,
    })
    if (ok) {
      esports.loadSlots(searchParams)
      esports.loadBookings()
    }
  }

  const handleShowBookings = () => {
    esports.loadBookings()
    setScreen('bookings')
  }

  const handleBack = () => {
    esports.setSlots(null)
    esports.setBookError('')
    esports.setBookSuccess('')
    esports.setError('')
    setScreen('main')
  }

  if (screen === 'bookings') {
    return (
      <MyBookings
        bookings={esports.bookings}
        loading={esports.bookingsLoading}
        error={esports.bookingsError}
        cancelLoading={esports.cancelLoading}
        onCancel={esports.cancelBooking}
        onBack={handleBack}
        onRefresh={esports.loadBookings}
        requestConfirm={requestConfirm}
      />
    )
  }

  if (screen === 'slots') {
    return (
      <SlotPicker
        slots={esports.slots}
        loading={esports.slotsLoading}
        error={esports.slotsError}
        bookLoading={esports.bookLoading}
        bookError={esports.bookError}
        bookSuccess={esports.bookSuccess}
        date={selectedDate}
        time={selectedTime}
        duration={selectedDuration}
        onBook={handleBook}
        onBack={handleBack}
      />
    )
  }

  const bookingsOpen = esports.config?.bookings_open !== false

  return (
    <div className="esports-flow">
      {esports.configLoading && (
        <div className="status-message scanning scanning-indicator">
          <span>Загрузка...</span>
        </div>
      )}

      {esports.error && (
        <div className="status-message error">
          <span className="status-icon">{'\u2715'}</span>
          <span>{esports.error}</span>
        </div>
      )}

      {!esports.configLoading && !esports.error && esports.config && !bookingsOpen && (
        <div className="status-message error">
          <span className="status-icon">{'\u2715'}</span>
          <span>Бронирование временно недоступно</span>
        </div>
      )}

      {!esports.configLoading && !esports.error && bookingsOpen && dateOptions.length > 0 && (
        <>
          <div className="esports-field">
            <label className="esports-field-label">Категория</label>
            <div className="esports-chips">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.slug}
                  className={`esports-chip ${selectedCategory === cat.slug ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat.slug)}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div className="esports-field">
            <label className="esports-field-label">Дата</label>
            <div className="esports-chips esports-chips-scroll">
              {dateOptions.map(opt => (
                <button
                  key={opt.value}
                  className={`esports-chip ${selectedDate === opt.value ? 'active' : ''}`}
                  onClick={() => setSelectedDate(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="esports-row">
            <div className="esports-field esports-field-flex">
              <label className="esports-field-label">Время</label>
              <div className="esports-chips esports-chips-scroll">
                {timeOptions.map(opt => (
                  <button
                    key={opt.value}
                    className={`esports-chip ${selectedTime === opt.value ? 'active' : ''}`}
                    onClick={() => setSelectedTime(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="esports-field esports-field-flex">
              <label className="esports-field-label">Длительность</label>
              <div className="esports-chips esports-chips-scroll">
                {DURATIONS.map(d => (
                  <button
                    key={d.value}
                    className={`esports-chip ${selectedDuration === d.value ? 'active' : ''}`}
                    onClick={() => setSelectedDuration(d.value)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            className="btn btn-primary esports-search-btn"
            onClick={handleSearch}
            disabled={!selectedDate || !selectedTime}
          >
            Найти свободные места
          </button>
        </>
      )}

      <div className="esports-actions">
        <button className="btn btn-secondary esports-action-btn" onClick={handleShowBookings}>
          Мои бронирования
        </button>
        <button className="btn btn-secondary esports-action-btn esports-logout-btn" onClick={() => {
          (async () => {
            const ok = await requestConfirm({
              title: 'Выйти из киберзоны?',
              message: 'Вы действительно хотите выйти из аккаунта киберзоны? Для повторного входа потребуется авторизация.',
              confirmText: 'Выйти',
              cancelText: 'Отмена',
              destructive: true
            })
            if (ok) esports.logout()
          })()
        }}>
          Выйти
        </button>
      </div>
    </div>
  )
}

// ── Slot picker ──────────────────────────────────────────────────

function SlotPicker({ slots, loading, error, bookLoading, bookError, bookSuccess, date, time, duration, onBook, onBack }) {
  const categories = useMemo(() => {
    if (!slots) return []
    return (slots.available_bookings || [])
      .map(cat => ({
        ...cat,
        devices: (cat.devices || []).filter(d => d.timeslots && d.timeslots.length > 0),
      }))
      .filter(cat => cat.devices.length > 0)
  }, [slots])

  const totalDevices = useMemo(() => categories.reduce((s, c) => s + c.devices.length, 0), [categories])

  const hasDevicesButNoSlots = useMemo(() => {
    if (!slots) return false
    const allDevices = (slots.available_bookings || []).reduce((s, c) => s + (c.devices?.length || 0), 0)
    return allDevices > 0 && totalDevices === 0
  }, [slots, totalDevices])

  return (
    <div className="esports-subscreen">
      <button className="esports-back-btn" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Назад
      </button>

      <div className="esports-hero">
        <div className="esports-hero-label">Свободные места</div>
        <div className="esports-hero-main">
          <div className="esports-hero-item">
            <div className="esports-hero-value">{loading ? '...' : totalDevices}</div>
            <div className="esports-hero-caption">Устройств</div>
          </div>
          <div className="esports-hero-item">
            <div className="esports-hero-value">{durationLabel(duration)}</div>
            <div className="esports-hero-caption">{formatBookingDate(date)} · {time}</div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="status-message scanning scanning-indicator">
          <span>Поиск мест...</span>
        </div>
      )}

      {error && (
        <div className="status-message error">
          <span className="status-icon">{'\u2715'}</span>
          <span>{translateError(error)}</span>
        </div>
      )}

      {bookSuccess && (
        <div className="status-message success">
          <span className="status-icon">{'\u2713'}</span>
          <span>{bookSuccess}</span>
        </div>
      )}

      {bookError && (
        <div className="status-message error">
          <span className="status-icon">{'\u2715'}</span>
          <span>{translateError(bookError)}</span>
        </div>
      )}

      {!loading && !error && totalDevices === 0 && !bookSuccess && (
        <div className="empty-state">
          <p>{hasDevicesButNoSlots
            ? 'Все места заняты на выбранное время. Попробуйте другое время или дату.'
            : 'Нет свободных мест на выбранное время'
          }</p>
        </div>
      )}

      {!loading && categories.length > 0 && (
        <div className="esports-results">
          {categories.map(cat => (
            <div key={cat.category_slug} className="esports-cat-group">
              <div className="esports-cat-label">{cat.category_name}</div>
              <div className="esports-device-list">
                {cat.devices.map(device => {
                  const singleSlot = device.timeslots.length === 1 ? device.timeslots[0] : null
                  const handleCardClick = singleSlot && !bookLoading
                    ? () => onBook(device.id, device.name, singleSlot.start_time || '', singleSlot.end_time || '')
                    : undefined
                  return (
                    <div
                      key={device.id}
                      className={`esports-device-card${singleSlot ? ' is-clickable' : ''}`}
                      onClick={handleCardClick}
                    >
                      <div className="esports-device-top">
                        <div className="esports-device-name">{device.name}</div>
                      </div>
                      <div className="esports-timeslots">
                        {device.timeslots.map((slot, si) => {
                          const startTime = slot.start_time || ''
                          const endTime = slot.end_time || ''
                          const label = startTime.slice(0, 5) + (endTime ? `\u2013${endTime.slice(0, 5)}` : '')
                          return (
                            <button
                              key={si}
                              className="esports-time-btn"
                              onClick={(e) => { e.stopPropagation(); onBook(device.id, device.name, startTime, endTime) }}
                              disabled={bookLoading}
                            >
                              {bookLoading ? '...' : label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── My bookings ──────────────────────────────────────────────────

function MyBookings({ bookings, loading, error, cancelLoading, onCancel, onBack, onRefresh, requestConfirm }) {
  const handleCancel = async (id, deviceName, timeRange) => {
    const confirmed = await requestConfirm({
      title: 'Отменить бронирование?',
      message: `${deviceName}${timeRange ? ` · ${timeRange}` : ''}`,
      confirmText: 'Отменить',
      cancelText: 'Назад',
    })
    if (!confirmed) return
    onCancel(id)
  }
  const items = useMemo(() => {
    if (!bookings) return []
    if (Array.isArray(bookings)) return bookings
    return bookings.bookings || bookings.results || bookings.items || []
  }, [bookings])

  return (
    <div className="esports-subscreen">
      <div className="esports-subscreen-top">
        <button className="esports-back-btn" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Назад
        </button>
        <button className="btn btn-secondary btn-compact" onClick={onRefresh} disabled={loading}>
          {loading ? '...' : 'Обновить'}
        </button>
      </div>

      <div className="esports-hero">
        <div className="esports-hero-label">Мои бронирования</div>
        <div className="esports-hero-main">
          <div className="esports-hero-item">
            <div className="esports-hero-value">{loading ? '...' : items.length}</div>
            <div className="esports-hero-caption">Всего</div>
          </div>
          <div className="esports-hero-item">
            <div className="esports-hero-value">
              {loading ? '...' : items.filter(b => {
                const s = (b.status || '').toUpperCase()
                return !s || s === 'PENDING' || s === 'ACTIVE' || s === 'CONFIRMED' || s === 'BOOKED'
              }).length}
            </div>
            <div className="esports-hero-caption">Активных</div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="status-message scanning scanning-indicator">
          <span>Загрузка...</span>
        </div>
      )}

      {error && (
        <div className="status-message error">
          <span className="status-icon">{'\u2715'}</span>
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="empty-state">
          <p>У вас пока нет бронирований</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="esports-booking-list">
          {items.map((b, i) => {
            const id = b.id || b.booking_id || i
            const device = b.device?.name || b.device_name || b.name || 'Место'
            const category = b.device?.category?.name || b.category_name || b.category || ''
            const status = (b.status || '').toUpperCase()
            const isCancellable = !status || status === 'PENDING' || status === 'ACTIVE' || status === 'CONFIRMED' || status === 'BOOKED'

            let dateLabel = ''
            let timeLabel = ''
            const startDt = b.start_datetime || b.booking_datetime || b.datetime || ''
            const endDt = b.end_datetime || ''
            if (startDt) {
              const m = startDt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
              if (m) {
                dateLabel = formatBookingDate(m[1])
                timeLabel = m[2]
              }
            }
            if (!dateLabel) {
              dateLabel = formatBookingDate(b.booking_date || b.date || '')
              timeLabel = (b.booking_time || b.time || b.start_time || '').slice(0, 5)
            }

            let endTimeLabel = ''
            if (endDt) {
              const m = endDt.match(/T(\d{2}:\d{2})/)
              if (m) endTimeLabel = m[1]
            }
            const timeRange = timeLabel && endTimeLabel ? `${timeLabel}–${endTimeLabel}` : timeLabel

            const STATUS_LABELS = { PENDING: 'Ожидание', CANCELED: 'Отменено', COMPLETED: 'Завершено', EXPIRED: 'Истекло' }

            return (
              <div key={id} className={`esports-booking-card ${!isCancellable ? 'is-past' : ''}`}>
                <div className="esports-booking-info">
                  <div className="esports-booking-device">{device}</div>
                  <div className="esports-booking-meta">
                    {category && <span className="esports-booking-badge">{category}</span>}
                    <span>{dateLabel}{timeRange ? ` · ${timeRange}` : ''}</span>
                  </div>
                  {status && !isCancellable && (
                    <div className="esports-booking-status">{STATUS_LABELS[status] || status}</div>
                  )}
                </div>
                {isCancellable && (
                  <button
                    className="btn btn-secondary btn-compact esports-cancel-btn"
                    onClick={() => handleCancel(id, device, timeRange)}
                    disabled={cancelLoading === id}
                  >
                    {cancelLoading === id ? '...' : 'Отменить'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────

export default function EsportsTab({ esports, tabDirection, requestConfirm }) {
  useEffect(() => {
    if (esports.esportsAuthorized === null) {
      esports.checkStatus()
    }
  }, [])

  return (
    <div className={`esports-section tab-pane ${tabDirection}`}>
      <div className="esports-shell">
        <div className="esports-header">
          <div>
            <div className="esports-title">Киберзона</div>
            <div className="esports-subtitle">Бронирование мест · esports.mirea.ru</div>
          </div>
        </div>

        {esports.esportsAuthorized === null && (
          <div className="status-message scanning scanning-indicator">
            <span>Проверка сессии...</span>
          </div>
        )}

        {esports.esportsAuthorized === false && (
          <EsportsLogin
            onLogin={esports.login}
            loading={esports.esportsLoginLoading}
            error={esports.esportsLoginError}
          />
        )}

        {esports.esportsAuthorized === true && (
          <BookingFlow esports={esports} requestConfirm={requestConfirm} />
        )}
      </div>
    </div>
  )
}
