import { useEffect, useState } from 'react'

const tg = window.Telegram?.WebApp

export default function useAcs({ isAuthorized }) {
  const [acsEvents, setAcsEvents] = useState([])
  const [acsLoading, setAcsLoading] = useState(false)
  const [acsError, setAcsError] = useState('')

  const loadAcsEvents = async () => {
    setAcsLoading(true)
    setAcsError('')
    try {
      const response = await fetch('/api/acs/events', {
        headers: { 'X-Telegram-Init-Data': tg?.initData || '' }
      })
      const data = await response.json()
      if (data?.needs_auth) {
        setAcsEvents([])
        setAcsError('Требуется авторизация')
      } else if (data?.success) {
        setAcsEvents(Array.isArray(data.events) ? data.events : [])
        setAcsError('')
      } else {
        setAcsEvents([])
        setAcsError(data?.message || 'Не удалось получить данные пропуска')
      }
    } catch (err) {
      setAcsEvents([])
      setAcsError('Ошибка соединения')
    } finally {
      setAcsLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized !== false) return
    setAcsEvents([])
    setAcsError('')
    setAcsLoading(false)
  }, [isAuthorized])

  return { acsEvents, acsLoading, acsError, loadAcsEvents }
}

