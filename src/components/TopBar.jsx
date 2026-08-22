import { useState, useEffect, useRef } from 'react'
import { Bell, Sun, Moon, Check, Circle, PackageX } from 'lucide-react'

export default function TopBar({ darkMode, onToggleDark, notifications = [] }) {
  const [open, setOpen] = useState(false)
  const [readIds, setReadIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('okanemo_read_notifs') || '[]') } catch { return [] }
  })
  const dropdownRef = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const unreadCount = notifications.filter(n => !readIds.includes(n.id)).length

  function markAll() {
    const ids = notifications.map(n => n.id)
    setReadIds(ids)
    localStorage.setItem('okanemo_read_notifs', JSON.stringify(ids))
  }

  function toggleRead(id) {
    const next = readIds.includes(id) ? readIds.filter(x => x !== id) : [...readIds, id]
    setReadIds(next)
    localStorage.setItem('okanemo_read_notifs', JSON.stringify(next))
  }

  return (
    <div className="top-right-actions">
      <label className="theme-switch" title="Toggle Dark Mode">
        <input type="checkbox" checked={darkMode} onChange={onToggleDark} />
        <span className="slider">
          <span className="slider-icon sun"><Sun /></span>
          <span className="slider-icon moon"><Moon /></span>
          <span className="slider-knob" />
        </span>
      </label>

      <div className="notification-container" ref={dropdownRef}>
        <button className="notification-bell" onClick={() => setOpen(o => !o)}>
          <Bell />
          {unreadCount > 0 && (
            <span className="notification-badge">{unreadCount}</span>
          )}
        </button>

        <div className={`notification-dropdown${open ? ' active' : ''}`}>
          <div className="notification-header">
            <h4><Bell className="icon-inline" /> Low Stock Alerts</h4>
            <button className="btn-mark-all-read" onClick={markAll}>
              <Check className="icon-sm" /> Mark all read
            </button>
          </div>
          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">No alerts</div>
            ) : notifications.map(n => (
              <div
                key={n.id}
                className={`notification-item${readIds.includes(n.id) ? ' read' : ''}`}
                onClick={() => toggleRead(n.id)}
              >
                <span className="icon"><PackageX /></span>
                <div className="details">
                  <div className="product-name">{n.name}</div>
                  <div className="stock-info">Only {n.stock} left in stock</div>
                </div>
                <button
                  className="btn-toggle-read"
                  title={readIds.includes(n.id) ? 'Mark unread' : 'Mark read'}
                  onClick={e => { e.stopPropagation(); toggleRead(n.id) }}
                >
                  {readIds.includes(n.id) ? <Circle /> : <Check />}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
