export default function ConfirmDialog({ confirmData, confirmPresence, onResolve }) {
  if (!confirmPresence.shouldRender) return null

  return (
    <div
      className={`sheet-modal-overlay confirm-overlay ${confirmPresence.visible ? 'is-open' : ''}`}
      onClick={() => onResolve(false)}
    >
      <div className="sheet-modal confirm-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-head">
          <div className="confirm-title">{confirmData.title}</div>
          <button
            className="account-close"
            type="button"
            onClick={() => onResolve(false)}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        {confirmData.message && (
          <div className="confirm-message">{confirmData.message}</div>
        )}

        <div className="confirm-actions">
          <button
            className="btn btn-secondary confirm-cancel"
            type="button"
            onClick={() => onResolve(false)}
          >
            {confirmData.cancelText || 'Отмена'}
          </button>
          <button
            className={`btn ${confirmData.destructive ? 'btn-danger' : 'btn-primary'} confirm-ok`}
            type="button"
            onClick={() => onResolve(true)}
          >
            {confirmData.confirmText || 'ОК'}
          </button>
        </div>
      </div>
    </div>
  )
}
