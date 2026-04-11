import { getInitials } from '../utils'
import { FriendProfileContent } from './ProfileSheet'

export default function FriendsModal({
  friendsModalPresence, friendsModalScreen, friendsModalNav, friendsModalParams,
  friendsTitle, friendsSubtitle, friendsScreenKey,
  // Friends data
  friends, pendingFriends, maxFriends,
  friendUsername, friendError, friendsLoading, friendsLoadingUi,
  // Friend profile
  friendProfile, friendProfileLoading, friendProfileError, friendProfileNotice,
  // Callbacks
  onSetFriendsModalOpen, onCloseFriendProfile,
  onSetFriendUsername, onSendFriendRequest,
  onAcceptFriend, onRejectFriend, onRemoveFriend,
  onToggleFriendFavorite,
  onOpenFriendProfile, requestConfirm,
  // Refs
  friendsModalRef, friendsScrollRef
}) {
  if (!friendsModalPresence.shouldRender) return null

  return (
    <div
      className={`sheet-modal-overlay ${friendsModalPresence.visible ? 'is-open' : ''}`}
      onClick={() => onSetFriendsModalOpen(false)}
    >
      <div ref={friendsModalRef} className="sheet-modal friends-modal" onClick={(e) => e.stopPropagation()}>
        <div className="account-header">
          <button
            className={`account-close sheet-back ${friendsModalScreen === 'friendProfile' ? '' : 'is-hidden'}`}
            type="button"
            onClick={onCloseFriendProfile}
            aria-label="Назад"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6"></path>
            </svg>
          </button>

          <div className="sheet-titles">
            <div className="account-title">{friendsTitle}</div>
            <div className="account-subtitle">{friendsSubtitle}</div>
          </div>
          <button
            className="account-close"
            type="button"
            onClick={() => onSetFriendsModalOpen(false)}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="friends-modal-body">
          <div ref={friendsScrollRef} className="friends-modal-scroll">
            <div
              className={`sheet-screen ${friendsModalNav === 'push' ? 'screen-push' : friendsModalNav === 'pop' ? 'screen-pop' : ''}`}
              key={friendsScreenKey}
            >
              {friendsModalScreen === 'list' && (
                <>
                  <div className="friends-add">
                    <input
                      className="friends-input"
                      value={friendUsername}
                      onChange={(e) => onSetFriendUsername(e.target.value)}
                      placeholder="@username друга"
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                    <button
                      className="btn btn-primary"
                      onClick={onSendFriendRequest}
                      disabled={friends.length >= maxFriends || friendsLoading}
                    >
                      Добавить
                    </button>
                  </div>
                  {friendError && <div className="friend-error">{friendError}</div>}

                  {pendingFriends.length > 0 && (
                    <div className="friends-section">
                      <div className="friends-section-title">Входящие запросы</div>
                      {pendingFriends.map((req) => (
                        <div
                          key={req.request_id}
                          className="friend-item pending friend-clickable"
                          onClick={() => onOpenFriendProfile({ id: req.from_id, name: req.from_name, username: req.from_username })}
                        >
                          <div className="friend-info">
                            <span className="friend-name">{req.from_name}</span>
                            {req.from_username && (
                              <span className="friend-username">@{req.from_username}</span>
                            )}
                          </div>
                          <div className="friend-actions">
                            <button
                              className="btn btn-small btn-accept"
                              onClick={(e) => { e.stopPropagation(); onAcceptFriend(req.request_id) }}
                            >
                              ✓
                            </button>
                            <button
                              className="btn btn-small btn-reject"
                              onClick={(e) => { e.stopPropagation(); onRejectFriend(req.request_id) }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="friends-section">
                    <div className="friends-section-title">Мои друзья</div>
                    {!friendsLoading && friends.length === 0 && (
                      <div className="friends-empty">Пока нет друзей. Добавь по username!</div>
                    )}
                    {friends.map((friend) => (
                      <div
                        key={friend.id}
                        className="friend-item friend-clickable"
                        onClick={() => onOpenFriendProfile(friend)}
                      >
                        <div className="friend-info">
                          <span className="friend-name">{friend.name}</span>
                          {friend.username && (
                            <span className="friend-username">@{friend.username}</span>
                          )}
                          {!friend.authorized && (
                            <span className="friend-noauth-badge">не авторизован</span>
                          )}
                        </div>
                        <div className="friend-actions">
                          <button
                            className={`btn btn-small btn-favorite ${friend.is_favorite ? 'is-active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              onToggleFriendFavorite(friend.relation_id)
                            }}
                            title={friend.is_favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
                            aria-label={friend.is_favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
                            aria-pressed={friend.is_favorite}
                          >
                            <svg
                              className="friend-favorite-icon"
                              width="15"
                              height="15"
                              viewBox="0 0 24 24"
                              fill={friend.is_favorite ? 'currentColor' : 'none'}
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M7.25 4.75A1.75 1.75 0 0 1 9 3h6a1.75 1.75 0 0 1 1.75 1.75V21l-4.75-2.9L7.25 21V4.75z" />
                            </svg>
                          </button>
                          <button
                            className="btn btn-small btn-remove"
                            onClick={(e) => {
                              e.stopPropagation()
                              ;(async () => {
                                const ok = await requestConfirm({
                                  title: 'Удалить друга?',
                                  message: `Вы действительно хотите удалить ${friend.name || 'этого пользователя'} из друзей?`,
                                  confirmText: 'Удалить',
                                  cancelText: 'Отмена',
                                  destructive: true
                                })
                                if (ok) await onRemoveFriend(friend.id)
                              })()
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="friends-hint">Избранные друзья автоматически включаются при отметке с друзьями</p>
                </>
              )}

              {friendsModalScreen === 'friendProfile' && (
                <FriendProfileContent
                  friendProfile={friendProfile}
                  friendProfileLoading={friendProfileLoading}
                  friendProfileError={friendProfileError}
                  friendProfileNotice={friendProfileNotice}
                  preview={friendsModalParams?.preview}
                />
              )}

            </div>
          </div>

          {friendsLoadingUi && (
            <div className="friends-loading-overlay" aria-live="polite">
              <div className="status-message scanning scanning-indicator friends-loading-pill">
                <span>Загрузка...</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
