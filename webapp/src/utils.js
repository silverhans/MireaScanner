export const MOSCOW_TIMEZONE = 'Europe/Moscow'

const getDateValue = (value) => {
  if (!value) return null
  if (value instanceof Date) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export const getInitials = (value) => {
  const name = (value || '').trim()
  if (!name) return 'MS'
  const parts = name.split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

export const formatDateTime = (value) => {
  if (!value) return '—'
  const date = getDateValue(value)
  if (!date) return String(value)
  return date.toLocaleString('ru-RU', {
    timeZone: MOSCOW_TIMEZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export const formatClock = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('ru-RU', {
    timeZone: MOSCOW_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
}

export const formatMoscowDate = (value, options = {}) => {
  const date = getDateValue(value)
  if (!date) return value ? String(value) : ''
  return date.toLocaleDateString('ru-RU', {
    timeZone: MOSCOW_TIMEZONE,
    ...options
  })
}

const pad2 = (value) => String(value).padStart(2, '0')

const MOSCOW_PARTS_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW_TIMEZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric'
})

export const getLocalDayKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const parts = MOSCOW_PARTS_FORMATTER.formatToParts(date)
  const map = {}
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  if (!map.year || !map.month || !map.day) return ''
  return `${map.year}-${pad2(map.month)}-${pad2(map.day)}`
}

export const fmtPoints = (value) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  const rounded = Math.round(num * 10) / 10
  return String(rounded).replace(/\.0$/, '')
}
