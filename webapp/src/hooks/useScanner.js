import { useState, useEffect, useRef } from 'react'

const tg = window.Telegram?.WebApp

export default function useScanner({ markWithFriends, friendsCount, selectedFriendIds, hapticsEnabled = true, onNeedsAuth }) {
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [results, setResults] = useState([])
  const [useNativeScanner, setUseNativeScanner] = useState(true)

  const html5QrCodeRef = useRef(null)
  const html5QrModuleRef = useRef(null)

  const triggerImpactHaptic = (style = 'light') => {
    if (!hapticsEnabled) return
    const haptic = tg?.HapticFeedback
    if (!haptic || typeof haptic.impactOccurred !== 'function') return
    try { haptic.impactOccurred(style) } catch {}
  }

  const triggerNotificationHaptic = (kind = 'success') => {
    if (!hapticsEnabled) return
    const haptic = tg?.HapticFeedback
    if (!haptic || typeof haptic.notificationOccurred !== 'function') return
    try { haptic.notificationOccurred(kind) } catch {}
  }

  // Detect native scanner on mount
  useEffect(() => {
    if (tg) setUseNativeScanner(typeof tg.showScanQrPopup === 'function')
  }, [])

  const stopScanner = async () => {
    if (tg?.closeScanQrPopup) { try { tg.closeScanQrPopup() } catch (e) {} }
    if (html5QrCodeRef.current) {
      try { await html5QrCodeRef.current.stop(); html5QrCodeRef.current = null } catch (err) {}
    }
  }

  const sendAttendance = async (qrData) => {
    try {
      const payload = { qr_data: qrData }

      // If marking with friends and some are selected, send their IDs
      if (markWithFriends && selectedFriendIds && selectedFriendIds.length > 0) {
        payload.friend_telegram_ids = selectedFriendIds
      } else if (markWithFriends && friendsCount > 0) {
        // Legacy: mark all friends if enabled but no selection
        payload.mark_friends = true
      }

      const response = await fetch('/api/attendance/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg?.initData || '' },
        body: JSON.stringify(payload)
      })
      const data = await response.json()
      if (data.needs_auth) { onNeedsAuth(); return { success: false, message: 'Требуется авторизация' } }
      return data
    } catch (err) {
      return { success: false, message: 'Ошибка соединения с сервером' }
    }
  }

  const onQrCodeSuccess = async (decodedText) => {
    setStatus('processing')
    setMessage('Отмечаю посещаемость...')
    triggerImpactHaptic('medium')
    try {
      const response = await sendAttendance(decodedText)
      if (response.success) {
        setStatus('success')
        setMessage('Успешно отмечено!')
        setResults(response.results || [])
        triggerNotificationHaptic('success')
      } else {
        setStatus('error')
        setMessage(response.message || 'Ошибка при отметке')
        triggerNotificationHaptic('error')
      }
    } catch (err) {
      setStatus('error')
      setMessage('Ошибка соединения')
    }
  }

  const startScanner = async () => {
    if (useNativeScanner && tg?.showScanQrPopup) {
      setStatus('scanning')
      setMessage('Сканируйте QR-код')
      tg.showScanQrPopup({ text: 'Наведите камеру на QR-код посещаемости' }, (data) => {
        if (data) { tg.closeScanQrPopup(); onQrCodeSuccess(data); return true }
        return false
      })
      return
    }
    try {
      setStatus('scanning')
      setMessage('Загрузка сканера...')
      setResults([])
      if (!html5QrModuleRef.current) html5QrModuleRef.current = import('html5-qrcode')
      const mod = await html5QrModuleRef.current
      const Html5Qrcode = mod?.Html5Qrcode
      if (!Html5Qrcode) throw new Error('Html5Qrcode not available')
      setMessage('Наведите камеру на QR-код')
      html5QrCodeRef.current = new Html5Qrcode('qr-reader')
      await html5QrCodeRef.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
        (decodedText) => { stopScanner(); onQrCodeSuccess(decodedText) },
        () => {}
      )
    } catch (err) {
      setStatus('error')
      setMessage('Не удалось получить доступ к камере')
    }
  }

  const resetScanner = () => { setStatus('idle'); setMessage(''); setResults([]) }

  return { status, message, results, useNativeScanner, startScanner, stopScanner, resetScanner }
}
