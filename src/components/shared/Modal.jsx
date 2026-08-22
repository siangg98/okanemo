import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, title, size = 'default', children }) {
  useEffect(() => {
    if (!open) return
    const onKey = e => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className={`modal-overlay${open ? ' active' : ''}`} onClick={handleOverlayClick}>
      <div className={`modal${size === 'small' ? ' modal-small' : ''}`}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
