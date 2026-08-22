/**
 * FormGroup — label + input wrapper.
 *
 * Usage:
 *   <FormGroup label="Product Name" required hint="Optional hint">
 *     <input type="text" ... />
 *   </FormGroup>
 *
 *   <FormGroup label="Category" required>
 *     <select>...</select>
 *   </FormGroup>
 */
export default function FormGroup({ label, required, hint, children, style }) {
  return (
    <div className="form-group" style={style}>
      {label && (
        <label>
          {label}
          {required && ' *'}
        </label>
      )}
      {children}
      {hint && <small>{hint}</small>}
    </div>
  )
}
