/**
 * A fact frozen by something already derived from it, shown as text rather than
 * as a disabled input.
 *
 * A disabled field still reads as "a control I ought to be able to use, and
 * can't" — text states what it is: a number already committed to stock, or a
 * currency every historical amount is denominated in. Styled to sit exactly
 * where an input would, so the form's rhythm is unchanged.
 *
 * Used by Shipments (an arrived box's lines, freight and dates) and Accounts (a
 * currency that records already reference).
 */
export default function FrozenValue({ children }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        fontSize: 14,
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </div>
  )
}
