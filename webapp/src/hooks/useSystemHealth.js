import { useState } from 'react'

export default function useSystemHealth() {
  const [systemHealth, setSystemHealth] = useState(null)
  const [systemHealthLoading, setSystemHealthLoading] = useState(false)

  const loadSystemHealth = async () => {
    setSystemHealthLoading(true)
    try {
      const response = await fetch('/api/health', { cache: 'no-store' })
      if (!response.ok) {
        setSystemHealth({
          ok: false,
          error: `HTTP ${response.status}`,
          checked_at: new Date().toISOString()
        })
        return
      }
      const data = await response.json()
      setSystemHealth({
        ...data,
        checked_at: new Date().toISOString()
      })
    } catch (err) {
      setSystemHealth({
        ok: false,
        error: 'Не удалось получить health',
        checked_at: new Date().toISOString()
      })
    } finally {
      setSystemHealthLoading(false)
    }
  }

  return { systemHealth, systemHealthLoading, loadSystemHealth }
}

