/**
 * Button — shared button component.
 *
 * Variants:
 *   primary   → btn-primary
 *   secondary → btn-secondary
 *   danger    → btn-danger
 *   icon      → btn-icon  (pass delete prop for red delete style)
 *   back      → btn-back
 *   add-row   → btn-add-row
 *   remove    → btn-remove
 *   clear     → btn-clear
 *
 * Icon content is a Lucide component; `.btn-icon svg` sizes it, so pass the
 * icon bare and put the wording in `title` — that tooltip is the only label an
 * icon-only button has.
 *
 * Usage:
 *   <Button variant="primary" onClick={fn}>Save</Button>
 *   <Button variant="icon" delete onClick={fn} title="Delete"><Trash2 /></Button>
 *   <Button variant="icon" onClick={fn} title="Edit"><Pencil /></Button>
 */
export default function Button({
  variant = 'primary',
  children,
  onClick,
  type = 'button',
  disabled,
  title,
  delete: isDelete,
  style,
  className,
}) {
  const base =
    variant === 'primary' ? 'btn-primary'
    : variant === 'secondary' ? 'btn-secondary'
    : variant === 'danger' ? 'btn-danger'
    : variant === 'icon' ? `btn-icon${isDelete ? ' delete' : ''}`
    : variant === 'back' ? 'btn-back'
    : variant === 'add-row' ? 'btn-add-row'
    : variant === 'remove' ? 'btn-remove'
    : variant === 'clear' ? 'btn-clear'
    : 'btn-primary'

  const cls = [base, className].filter(Boolean).join(' ')

  return (
    <button
      type={type}
      className={cls}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
    >
      {children}
    </button>
  )
}
