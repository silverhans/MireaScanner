import { useRef, useState } from 'react'

const tg = window.Telegram?.WebApp

export default function useAuth({ onAuthorized, onNotify } = {}) {
  const [isAuthorized, setIsAuthorized] = useState(null)
  const [accountInfo, setAccountInfo] = useState(null)
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginStep, setLoginStep] = useState('creds')
  const [login2faState, setLogin2faState] = useState(null)
  const [loginPendingLogin, setLoginPendingLogin] = useState('')
  const [loginChallengeKind, setLoginChallengeKind] = useState('otp')
  const [deleteLoading, setDeleteLoading] = useState(false)

  const loginRef = useRef(null)
  const passwordRef = useRef(null)
  const otpRef = useRef(null)

  const resetLoginFlow = () => {
    setLoginStep('creds')
    setLogin2faState(null)
    setLoginPendingLogin('')
    setLoginChallengeKind('otp')
    setLoginError('')
    if (otpRef.current) otpRef.current.value = ''
    requestAnimationFrame(() => requestAnimationFrame(() => loginRef.current?.focus?.()))
  }

  const checkAuthStatus = async () => {
    try {
      const response = await fetch('/api/auth/status', {
        headers: { 'X-Telegram-Init-Data': tg?.initData || '' }
      })
      if (response.ok) {
        const data = await response.json()
        setIsAuthorized(data.authorized)
        setAccountInfo(data)
        if (data.authorized && typeof onAuthorized === 'function') onAuthorized()
      } else {
        setIsAuthorized(false)
      }
    } catch (err) {
      setIsAuthorized(false)
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    const login = loginRef.current?.value?.trim?.()
    const password = passwordRef.current?.value
    if (!login || !password) { setLoginError('Введите логин и пароль'); return }
    setIsLoggingIn(true)
    setLoginError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg?.initData || '' },
        body: JSON.stringify({ login, password })
      })
      const data = await response.json()
      if (data.success) {
        setIsAuthorized(true)
        setAccountInfo((prev) => ({ ...(prev || {}), authorized: true, login, user_name: prev?.user_name || login }))
        setLoginStep('creds')
        setLogin2faState(null)
        setLoginPendingLogin('')
        setLoginChallengeKind('otp')
        if (onNotify) onNotify('success')
        if (typeof onAuthorized === 'function') onAuthorized()
      } else if (data.needs_2fa && data.state) {
        setLoginStep('otp')
        setLogin2faState(data.state)
        setLoginPendingLogin(login)
        setLoginChallengeKind(data.challenge_kind || 'otp')
        setLoginError('')
        if (passwordRef.current) passwordRef.current.value = ''
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (otpRef.current) { otpRef.current.value = ''; otpRef.current.focus?.() }
        }))
        if (onNotify) onNotify('success')
      } else {
        setLoginError(data.message || 'Ошибка авторизации')
        if (onNotify) onNotify('error')
      }
    } catch (err) {
      setLoginError('Ошибка соединения')
      if (onNotify) onNotify('error')
    } finally {
      setIsLoggingIn(false)
    }
  }

  const handleOtp = async (e) => {
    e.preventDefault()
    const state = login2faState
    const code = otpRef.current?.value?.trim?.()
    if (!state) { setLoginError('Сессия входа истекла. Попробуйте войти заново.'); setLoginStep('creds'); return }
    if (!code) { setLoginError('Введите код подтверждения'); return }
    setIsLoggingIn(true)
    setLoginError('')
    try {
      const response = await fetch('/api/auth/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg?.initData || '' },
        body: JSON.stringify({ state, code })
      })
      const data = await response.json()
      if (data.success) {
        const login = data.login || loginPendingLogin || loginRef.current?.value?.trim?.() || ''
        setIsAuthorized(true)
        setAccountInfo((prev) => ({ ...(prev || {}), authorized: true, login, user_name: prev?.user_name || login }))
        setLoginStep('creds')
        setLogin2faState(null)
        setLoginPendingLogin('')
        setLoginChallengeKind('otp')
        if (otpRef.current) otpRef.current.value = ''
        if (onNotify) onNotify('success')
        if (typeof onAuthorized === 'function') onAuthorized()
      } else if (data.needs_2fa && data.state) {
        setLogin2faState(data.state)
        if (data.challenge_kind) setLoginChallengeKind(data.challenge_kind)
        setLoginError(data.message || 'Неверный код подтверждения')
        if (otpRef.current) { otpRef.current.value = ''; otpRef.current.focus?.() }
        if (onNotify) onNotify('error')
      } else {
        setLoginError(data.message || 'Ошибка авторизации')
        setLoginStep('creds')
        setLogin2faState(null)
        setLoginPendingLogin('')
        setLoginChallengeKind('otp')
        if (onNotify) onNotify('error')
      }
    } catch (err) {
      setLoginError('Ошибка соединения')
      if (onNotify) onNotify('error')
    } finally {
      setIsLoggingIn(false)
    }
  }

  return {
    isAuthorized, setIsAuthorized,
    accountInfo, setAccountInfo,
    loginError, setLoginError,
    isLoggingIn,
    loginStep,
    loginPendingLogin,
    loginChallengeKind,
    login2faState,
    deleteLoading, setDeleteLoading,
    loginRef, passwordRef, otpRef,
    checkAuthStatus,
    handleLogin,
    handleOtp,
    resetLoginFlow
  }
}
