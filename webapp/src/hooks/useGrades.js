import { useState, useEffect } from 'react'

const tg = window.Telegram?.WebApp

export default function useGrades({ isAuthorized, activeTab }) {
  const [gradesData, setGradesData] = useState(null)
  const [gradesLoading, setGradesLoading] = useState(false)
  const [gradesError, setGradesError] = useState('')
  const [gradesAttempted, setGradesAttempted] = useState(false)

  // Auto-load grades when switching to grades tab
  useEffect(() => {
    if (!isAuthorized) return
    if (activeTab !== 'grades') return
    if (gradesAttempted) return
    setGradesAttempted(true)
    loadGrades()
  }, [isAuthorized, activeTab, gradesAttempted])

  // Reset grades on logout
  useEffect(() => {
    if (isAuthorized !== false) return
    setGradesAttempted(false)
    setGradesData(null)
    setGradesError('')
  }, [isAuthorized])

  const loadGrades = async () => {
    setGradesLoading(true)
    setGradesError('')
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)
      const response = await fetch('/api/grades', {
        headers: { 'X-Telegram-Init-Data': tg?.initData || '' },
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      const data = await response.json()
      if (data.needs_auth) {
        setGradesData(null)
        setGradesError('Требуется авторизация')
        return { needsAuth: true }
      }
      if (data.success) {
        setGradesData(data)
        setGradesError('')
      } else {
        setGradesData(null)
        setGradesError(data.message || 'Не удалось получить баллы')
      }
    } catch (err) {
      setGradesData(null)
      setGradesError(err?.name === 'AbortError' ? 'Сервер не отвечает (таймаут)' : 'Ошибка соединения')
    } finally {
      setGradesLoading(false)
    }
  }

  return { gradesData, gradesLoading, gradesError, loadGrades }
}
