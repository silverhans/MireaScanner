export default function LoginForm({
  loginStep, loginError, isLoggingIn, loginPendingLogin, challengeKind,
  onLogin, onOtp, onReset, onOpenPrivacy,
  loginRef, passwordRef, otpRef
}) {
  const isEmailCode = challengeKind === 'email_code'

  return (
    <div className="scanner-section">
      <form className="login-form" onSubmit={loginStep === 'otp' ? onOtp : onLogin}>
        <div className="login-header">
          <svg className="login-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            {loginStep === 'otp' && isEmailCode ? (
              <>
                <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                <polyline points="22,6 12,13 2,6"></polyline>
              </>
            ) : (
              <>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </>
            )}
          </svg>
          <h2>{loginStep === 'otp'
            ? (isEmailCode ? 'Код на почте' : 'Подтверждение входа')
            : 'Вход в МИРЭА'}</h2>
          <p>
            {loginStep === 'otp'
              ? (isEmailCode
                ? 'На вашу почту МИРЭА отправлен код подтверждения'
                : 'Введите одноразовый код (2FA)')
              : 'Используйте данные от личного кабинета'}
          </p>
          {loginStep === 'otp' && loginPendingLogin && (
            <p className="login-2fa-meta">{loginPendingLogin}</p>
          )}
        </div>

        {loginError && <div className="login-error">{loginError}</div>}

        {loginStep === 'otp' ? (
          <>
            <div className="input-group">
              <input
                key="otp-input"
                ref={otpRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={isEmailCode ? 'Код с почты' : 'Код (6 цифр)'}
                pattern="[0-9]*"
                disabled={isLoggingIn}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-large"
              disabled={isLoggingIn}
            >
              {isLoggingIn ? 'Проверка...' : 'Подтвердить'}
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-large"
              onClick={onReset}
              disabled={isLoggingIn}
            >
              Назад
            </button>
          </>
        ) : (
          <>
            <div className="input-group">
              <input
                ref={loginRef}
                type="email"
                placeholder="Email (name@edu.mirea.ru)"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                disabled={isLoggingIn}
              />
            </div>

            <div className="input-group">
              <input
                ref={passwordRef}
                type="password"
                placeholder="Пароль"
                autoComplete="current-password"
                disabled={isLoggingIn}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-large"
              disabled={isLoggingIn}
            >
              {isLoggingIn ? 'Вход...' : 'Войти'}
            </button>

            <p className="login-privacy">
              Нажимая «Войти», вы соглашаетесь с{' '}
              <button type="button" className="login-privacy-link" onClick={onOpenPrivacy}>
                политикой конфиденциальности
              </button>
            </p>
          </>
        )}
      </form>
    </div>
  )
}
