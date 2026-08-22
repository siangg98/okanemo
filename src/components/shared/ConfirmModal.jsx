import Modal from './Modal'

export default function ConfirmModal({ open, onClose, onConfirm, title, message }) {
  function handleConfirm() {
    onConfirm()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="small">
      <div style={{ padding: '24px' }}>
        <p style={{ marginBottom: 24, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-danger" onClick={handleConfirm}>
            Delete
          </button>
        </div>
      </div>
    </Modal>
  )
}
