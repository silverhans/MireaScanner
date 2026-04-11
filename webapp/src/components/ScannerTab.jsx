import { formatClock } from '../utils'

export default function ScannerTab({
  status, message, results, useNativeScanner, tabDirection,
  // Dashboard data
  dashboardName, dashboardLogin, dashboardGroup, dashboardAuthorized, dashboardAuthLabel,
  // Today's schedule
  todaySchedule, scheduleLoading, scheduleError,
  // Friends
  friends, maxFriends, markWithFriends, selectedFriendIds,
  // Callbacks
  onStartScanner, onStopScanner, onResetScanner,
  onOpenProfile, onTabChange, onOpenFriendsModal,
  onSetMarkWithFriends, onToggleFriendSelection,
  // Refs
  friendsQuickBtnRef,
  // Tabs
  visibleTabs
}) {
  return (
    <div className={`scanner-section tab-pane ${tabDirection} ${status === 'idle' ? 'is-dashboard' : ''}`}>
      {/* Idle State */}
      {status === 'idle' && (
        <div className="dashboard">
          <div className="dashboard-hero">
            <div className="dashboard-hero-top">
              <div className="dashboard-hero-text">
                <div className="dashboard-label">Сканер посещаемости</div>
                <div className="dashboard-name">{dashboardName}</div>
                <div className="dashboard-subtitle">Быстрая отметка по QR-коду</div>
                <div className="dashboard-meta">
                  <span className={`status-pill ${dashboardAuthorized ? 'is-on' : 'is-off'}`}>
                    {dashboardAuthLabel}
                  </span>
                  {dashboardLogin && <span className="meta-item">{dashboardLogin}</span>}
                  {dashboardGroup ? (
                    <span className="meta-item">{dashboardGroup}</span>
                  ) : (
                    <span className="meta-item muted">Группа не указана</span>
                  )}
                </div>
              </div>
              <button className="dashboard-profile-btn" onClick={onOpenProfile}>
                Профиль
              </button>
            </div>

            <button className="btn btn-primary btn-large" onClick={onStartScanner}>
              Сканировать QR-код
            </button>
          </div>

          {friends.length > 0 && (
            <div className="dashboard-card dashboard-friends">
              <div className="dashboard-card-head">
                <div className="dashboard-card-title">Отметка за друзей</div>
                <div className="dashboard-card-meta">{selectedFriendIds.length}/{friends.length}</div>
              </div>

              <div className="dashboard-toggles">
                <label className="friends-checkbox">
                  <input
                    type="checkbox"
                    checked={markWithFriends}
                    onChange={(e) => onSetMarkWithFriends(e.target.checked)}
                  />
                  <span>Отметить с друзьями ({friends.length})</span>
                </label>
              </div>

              {markWithFriends && (
                <div className="group-card friends-card">
                  <div className="group-header">
                    <span className="group-title">Выбери друзей</span>
                    <span className="group-count">{selectedFriendIds.length}/{friends.length}</span>
                  </div>
                  <ul className="group-members">
                    {friends.map((friend) => (
                      <li key={friend.id} className="friend-selectable">
                        <label className={`friend-select-label ${selectedFriendIds.includes(friend.id) ? 'is-selected' : ''}`}>
                          <input
                            type="checkbox"
                            checked={selectedFriendIds.includes(friend.id)}
                            onChange={() => onToggleFriendSelection(friend.id)}
                            className="friend-checkbox"
                          />
                          <span className={`member-indicator ${friend.authorized ? '' : 'inactive'}`}></span>
                          <span className="friend-select-name">
                            {friend.name}
                            {!friend.authorized && <span className="friend-noauth"> (не авторизован)</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="dashboard-card dashboard-today">
            <div className="dashboard-card-head">
              <div className="dashboard-card-title">Сегодня</div>
              {dashboardGroup && <div className="dashboard-card-meta">{dashboardGroup}</div>}
            </div>

            {scheduleLoading && (
              <div className="dashboard-muted">Загружаю расписание...</div>
            )}

            {!scheduleLoading && scheduleError && (
              <div className="dashboard-error">{scheduleError}</div>
            )}

            {!scheduleLoading && !scheduleError && !dashboardGroup && (
              <div className="dashboard-muted">
                Укажи группу, чтобы видеть пары на сегодня.
              </div>
            )}

            {!scheduleLoading && !scheduleError && dashboardGroup && todaySchedule.events.length === 0 && (
              <div className="dashboard-muted">Сегодня пар нет.</div>
            )}

            {!scheduleLoading && !scheduleError && todaySchedule.next && (
              <div className="today-next">
                <div className="today-time">
                  {formatClock(todaySchedule.next._start)}
                  {todaySchedule.next._end ? `–${formatClock(todaySchedule.next._end)}` : ''}
                </div>
                <div className="today-title">{todaySchedule.next.summary || 'Занятие'}</div>
                {todaySchedule.next.location && (
                  <div className="today-location">{todaySchedule.next.location}</div>
                )}
                {todaySchedule.events.length > 1 && (
                  <div className="today-more">Ещё {todaySchedule.events.length - 1} пары</div>
                )}
              </div>
            )}

            <div className="dashboard-card-actions">
              <button
                className="btn btn-secondary btn-compact"
                onClick={() => onTabChange('schedule')}
              >
                Открыть расписание
              </button>
            </div>
          </div>

          <div className="dashboard-card dashboard-shortcuts">
            <div className="dashboard-card-head">
              <div className="dashboard-card-title">Быстрый доступ</div>
            </div>
            <div className="dashboard-actions">
              {visibleTabs?.includes('schedule') && (
                <button className="quick-action" onClick={() => onTabChange('schedule')}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  <span>Пары</span>
                </button>
              )}
              {visibleTabs?.includes('grades') && (
                <button className="quick-action" onClick={() => onTabChange('grades')}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
                    <path d="M6 12v5c3 3 9 3 12 0v-5"></path>
                  </svg>
                  <span>БРС</span>
                </button>
              )}
              {visibleTabs?.includes('passes') && (
                <button className="quick-action" onClick={() => onTabChange('passes')}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="5" width="18" height="14" rx="2"></rect>
                    <path d="M7 9h10"></path>
                    <path d="M7 13h5"></path>
                  </svg>
                  <span>Пропуск</span>
                </button>
              )}
              {visibleTabs?.includes('maps') && (
                <button className="quick-action" onClick={() => onTabChange('maps')}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"></path>
                    <path d="M9 4v14"></path>
                    <path d="M15 6v14"></path>
                  </svg>
                  <span>Карты</span>
                </button>
              )}
              {visibleTabs?.includes('esports') && (
                <button className="quick-action" onClick={() => onTabChange('esports')}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                    <path d="M6 10v4M6 12h2"></path>
                    <circle cx="17" cy="10" r="1" fill="currentColor" stroke="none"></circle>
                    <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"></circle>
                  </svg>
                  <span>Киберзона</span>
                </button>
              )}
              <button
                ref={friendsQuickBtnRef}
                className="quick-action"
                onClick={() => onOpenFriendsModal(friendsQuickBtnRef.current)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <span>Друзья</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scanning State - fallback */}
      {status === 'scanning' && !useNativeScanner && (
        <>
          <div id="qr-reader"></div>
          <div className="status-message scanning scanning-indicator">
            <span>{message}</span>
          </div>
          <button className="btn btn-secondary" onClick={() => { onStopScanner(); onResetScanner() }}>
            Отмена
          </button>
        </>
      )}

      {/* Scanning with native */}
      {status === 'scanning' && useNativeScanner && (
        <>
          <div className="status-message scanning scanning-indicator">
            <span>Откройте камеру...</span>
          </div>
          <button className="btn btn-secondary" onClick={() => { onStopScanner(); onResetScanner() }}>
            Отмена
          </button>
        </>
      )}

      {/* Processing State */}
      {status === 'processing' && (
        <div className="status-message processing">
          <span className="status-icon">⏳</span>
          <span>{message}</span>
        </div>
      )}

      {/* Success State */}
      {status === 'success' && (
        <>
          <div className="status-message success">
            <span className="status-icon">✓</span>
            <span>{message}</span>
          </div>

          {results.length > 0 && (
            <div className="results-list">
              {results.map((result, index) => {
                let badgeClass, badgeText
                if (!result.success) {
                  badgeClass = 'error'
                  badgeText = 'Ошибка'
                } else {
                  badgeClass = 'success'
                  badgeText = 'OK'
                }
                return (
                  <div key={index} className="result-item">
                    <span className="name">{result.name}</span>
                    <span className={`status-badge ${badgeClass}`}>{badgeText}</span>
                  </div>
                )
              })}
              {results.some(r => r.success && !r.is_self) && (
                <p className="results-friend-note">Если отметка не появилась в ведомости — друг не проходил через турникет</p>
              )}
            </div>
          )}

          <button className="btn btn-primary" onClick={onStartScanner}>
            Сканировать ещё
          </button>
          <button className="btn btn-secondary" onClick={onResetScanner}>
            На главную
          </button>
        </>
      )}

      {/* Error State */}
      {status === 'error' && (
        <>
          <div className="status-message error">
            <span className="status-icon">✕</span>
            <span>{message}</span>
          </div>
          <button className="btn btn-primary" onClick={onStartScanner}>
            Попробовать снова
          </button>
          <button className="btn btn-secondary" onClick={onResetScanner}>
            На главную
          </button>
        </>
      )}
    </div>
  )
}
