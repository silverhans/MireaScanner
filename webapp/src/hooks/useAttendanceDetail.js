import { useState, useRef, useCallback } from 'react'

const tg = window.Telegram?.WebApp

export default function useAttendanceDetail() {
  const [detailCache, setDetailCache] = useState({})
  const inflightRef = useRef({})

  const loadDetail = useCallback(async (disciplineId, semester) => {
    if (!disciplineId) return
    if (inflightRef.current[disciplineId]) return

    setDetailCache(prev => ({
      ...prev,
      [disciplineId]: { loading: true, error: '', data: null }
    }))
    inflightRef.current[disciplineId] = true

    try {
      const params = new URLSearchParams({ discipline_id: disciplineId })
      if (semester) params.set('semester', semester)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 20000)
      const response = await fetch(`/api/attendance/detail?${params.toString()}`, {
        headers: { 'X-Telegram-Init-Data': tg?.initData || '' },
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      const json = await response.json()
      if (json.success) {
        setDetailCache(prev => ({
          ...prev,
          [disciplineId]: { loading: false, error: '', data: json }
        }))
      } else {
        setDetailCache(prev => ({
          ...prev,
          [disciplineId]: { loading: false, error: json.message || 'Ошибка', data: null }
        }))
      }
    } catch (err) {
      setDetailCache(prev => ({
        ...prev,
        [disciplineId]: {
          loading: false,
          error: err?.name === 'AbortError' ? 'Таймаут' : 'Ошибка соединения',
          data: null
        }
      }))
    } finally {
      delete inflightRef.current[disciplineId]
    }
  }, [])

  const resetCache = useCallback(() => {
    setDetailCache({})
    inflightRef.current = {}
  }, [])

  return { detailCache, loadDetail, resetCache }
}
