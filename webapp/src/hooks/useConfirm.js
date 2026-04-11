import { useState, useRef, useEffect } from 'react'

export default function useConfirm() {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmData, setConfirmData] = useState({
    title: '',
    message: '',
    confirmText: 'ОК',
    cancelText: 'Отмена',
    destructive: false
  })
  const confirmResolverRef = useRef(null)

  const requestConfirm = ({ title, message, confirmText, cancelText, destructive = false }) => {
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve
      setConfirmData({ title: title || 'Подтверждение', message: message || '', confirmText: confirmText || 'ОК', cancelText: cancelText || 'Отмена', destructive: !!destructive })
      setConfirmOpen(true)
    })
  }

  const resolveConfirm = (value) => {
    setConfirmOpen(false)
    const resolve = confirmResolverRef.current
    confirmResolverRef.current = null
    if (resolve) resolve(!!value)
  }

  useEffect(() => {
    return () => {
      if (confirmResolverRef.current) {
        try { confirmResolverRef.current(false) } catch (_err) {}
        confirmResolverRef.current = null
      }
    }
  }, [])

  return { confirmOpen, setConfirmOpen, confirmData, requestConfirm, resolveConfirm }
}
