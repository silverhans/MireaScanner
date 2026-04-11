import { useState, useCallback } from 'react'

const tg = window.Telegram?.WebApp

const headers = () => ({
  'X-Telegram-Init-Data': tg?.initData || ''
})

const jsonHeaders = () => ({
  ...headers(),
  'Content-Type': 'application/json'
})

export default function useEsports() {
  // Auth
  const [esportsAuthorized, setEsportsAuthorized] = useState(null) // null = unknown
  const [esportsLoginLoading, setEsportsLoginLoading] = useState(false)
  const [esportsLoginError, setEsportsLoginError] = useState('')

  // Config (categories)
  const [config, setConfig] = useState(null)
  const [configLoading, setConfigLoading] = useState(false)

  // Slots
  const [slots, setSlots] = useState(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState('')

  // Booking
  const [bookLoading, setBookLoading] = useState(false)
  const [bookError, setBookError] = useState('')
  const [bookSuccess, setBookSuccess] = useState('')

  // My bookings
  const [bookings, setBookings] = useState(null)
  const [bookingsLoading, setBookingsLoading] = useState(false)
  const [bookingsError, setBookingsError] = useState('')

  // Cancel
  const [cancelLoading, setCancelLoading] = useState(null) // booking_id being cancelled

  // General error
  const [error, setError] = useState('')

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/esports/status', { headers: headers() })
      const data = await res.json()
      if (data.success) {
        setEsportsAuthorized(data.authorized)
        return data.authorized
      }
      setEsportsAuthorized(false)
      return false
    } catch {
      setEsportsAuthorized(false)
      return false
    }
  }, [])

  const login = useCallback(async (email, password) => {
    setEsportsLoginLoading(true)
    setEsportsLoginError('')
    try {
      const res = await fetch('/api/esports/login', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ email, password })
      })
      const data = await res.json()
      if (data.success) {
        setEsportsAuthorized(true)
        return true
      }
      setEsportsLoginError(data.message || 'Ошибка авторизации')
      return false
    } catch {
      setEsportsLoginError('Ошибка соединения')
      return false
    } finally {
      setEsportsLoginLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/esports/logout', {
        method: 'POST',
        headers: headers()
      })
    } catch {}
    setEsportsAuthorized(false)
    setConfig(null)
    setSlots(null)
    setBookings(null)
  }, [])

  const loadConfig = useCallback(async () => {
    setConfigLoading(true)
    setError('')
    try {
      const res = await fetch('/api/esports/config', { headers: headers() })
      const data = await res.json()
      if (data.success) {
        setConfig(data.data)
      } else {
        if (res.status === 401) setEsportsAuthorized(false)
        setError(data.message || 'Не удалось загрузить категории')
      }
    } catch {
      setError('Ошибка соединения')
    } finally {
      setConfigLoading(false)
    }
  }, [])

  const loadSlots = useCallback(async ({ date, duration, start_time, category }) => {
    setSlotsLoading(true)
    setSlotsError('')
    setSlots(null)
    try {
      const params = new URLSearchParams({ date, duration: String(duration), start_time, category: category || 'all' })
      const res = await fetch(`/api/esports/slots?${params}`, { headers: headers() })
      const data = await res.json()
      if (data.success) {
        setSlots(data.data)
      } else {
        if (res.status === 401) setEsportsAuthorized(false)
        setSlotsError(data.message || 'Не удалось загрузить слоты')
      }
    } catch {
      setSlotsError('Ошибка соединения')
    } finally {
      setSlotsLoading(false)
    }
  }, [])

  const book = useCallback(async ({ device_id, booking_datetime, booking_duration }) => {
    setBookLoading(true)
    setBookError('')
    setBookSuccess('')
    try {
      const res = await fetch('/api/esports/book', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ device_id, booking_datetime, booking_duration })
      })
      const data = await res.json()
      if (data.success) {
        setBookSuccess('Место забронировано!')
        return true
      }
      if (res.status === 401) setEsportsAuthorized(false)
      setBookError(data.message || 'Не удалось забронировать')
      return false
    } catch {
      setBookError('Ошибка соединения')
      return false
    } finally {
      setBookLoading(false)
    }
  }, [])

  const loadBookings = useCallback(async () => {
    setBookingsLoading(true)
    setBookingsError('')
    try {
      const res = await fetch('/api/esports/bookings', { headers: headers() })
      const data = await res.json()
      if (data.success) {
        setBookings(data.data)
      } else {
        if (res.status === 401) setEsportsAuthorized(false)
        setBookingsError(data.message || 'Не удалось загрузить бронирования')
      }
    } catch {
      setBookingsError('Ошибка соединения')
    } finally {
      setBookingsLoading(false)
    }
  }, [])

  const cancelBooking = useCallback(async (bookingId) => {
    setCancelLoading(bookingId)
    try {
      const res = await fetch('/api/esports/cancel', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ booking_id: bookingId })
      })
      const data = await res.json()
      if (data.success) {
        // Reload bookings after cancel
        await loadBookings()
        return true
      }
      if (res.status === 401) setEsportsAuthorized(false)
      return false
    } catch {
      return false
    } finally {
      setCancelLoading(null)
    }
  }, [loadBookings])

  return {
    esportsAuthorized,
    esportsLoginLoading, esportsLoginError, setEsportsLoginError,
    config, configLoading,
    slots, slotsLoading, slotsError,
    bookLoading, bookError, bookSuccess, setBookError, setBookSuccess,
    bookings, bookingsLoading, bookingsError,
    cancelLoading,
    error, setError,
    checkStatus, login, logout,
    loadConfig, loadSlots, book,
    loadBookings, cancelBooking,
    setSlots
  }
}
