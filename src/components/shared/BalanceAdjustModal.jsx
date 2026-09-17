import { useEffect, useState } from 'react'
import Modal from './Modal'
import AccountIcon from './AccountIcon'
import { useApp } from '../../hooks/useApp'
import { formatAmount, calculateAccountBalance } from '../../utils/helpers'

const today = () => new Date().toISOString().split('T')[0]
const emptyForm = { date: '', type: 'add', amount: '', reason: '' }

const toCents = n => Math.round((parseFloat(n) || 0) * 100) / 100

/**
 * Record a manual balance adjustment, or edit one already recorded.
 *
 * An adjustment is a signed delta stored on the account, so there is no replay
 * to worry about: `calculateAccountBalance` sums them and an edit moves the
 * balance by the difference alone. What does need care is the three types,
 * which are all read against the *current* balance. On an edit that balance
 * already contains the record being changed, so every type works off
 * `baseBalance` — the balance with this adjustment taken back out. Without it,
 * re-saving an untouched adjustment would stack a second copy of itself on top.
 *
 * The delta is rounded to cents on the way in. `Set Balance to` derives it by
 * subtraction, and a balance carrying fractional cents — fee-derived net
 * revenue does — yields a delta like 43.95465 that the amount input's
 * `step="0.01"` rejects outright: the record would save once and then be
 * unopenable, blocking the date and reason edits behind a field the owner has
 * to retype. Rounding costs sub-cent exactness on `Set Balance to` against such
 * a balance, which no display resolves anyway, and buys an amount that is
 * always a real money figure.
 */
export default function BalanceAdjustModal({ accountId, adjustmentId, onClose }) {
  const { state, dispatch } = useApp()
  const [form, setForm] = useState({ ...emptyForm, date: today() })

  const account = accountId ? state.accounts.find(a => a.id === accountId) : null
  const currency = account?.currency || 'MYR'
  const existing = adjustmentId
    ? (account?.adjustments || []).find(adj => adj.id === adjustmentId)
    : null

  // Re-seed on every open. One component serves the card's "adjust balance"
  // button and the edit button on an adjustment row in the history, so the form
  // cannot be initialised once at mount.
  useEffect(() => {
    if (!accountId) return
    setForm(
      existing
        ? {
            date: existing.date,
            // A `set` adjustment was stored as the delta it worked out to, so
            // there is nothing left to tell it apart from an add or a subtract
            // — the sign is the whole record.
            type: (parseFloat(existing.amount) || 0) < 0 ? 'subtract' : 'add',
            // Rounded here too: a record stored before the rounding above
            // would otherwise seed a value its own input rejects.
            amount: String(Math.abs(toCents(existing.amount))),
            reason: existing.reason || '',
          }
        : { ...emptyForm, date: today() }
    )
  }, [accountId, existing])

  const currentBalance = accountId
    ? calculateAccountBalance(
        accountId,
        state.accounts,
        state.expenses,
        state.sales,
        state.reloads,
        state.transfers
      )
    : 0
  const baseBalance = currentBalance - (existing ? parseFloat(existing.amount) || 0 : 0)

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
  }

  /** The signed delta the form currently describes, in whole cents. */
  function getAdjustmentAmount() {
    const amount = parseFloat(form.amount) || 0
    if (form.type === 'add') return amount
    if (form.type === 'subtract') return -amount
    if (form.type === 'set') return toCents(amount - baseBalance)
    return 0
  }

  function handleSubmit(e) {
    e.preventDefault()
    const adjustment = {
      date: form.date,
      amount: getAdjustmentAmount(),
      reason: form.reason || 'Manual adjustment',
    }

    if (existing) {
      // Spread over `existing` so the id — and anything else the record picked
      // up — survives the edit.
      dispatch({
        type: 'UPDATE_ADJUSTMENT',
        payload: { accountId, adjustment: { ...existing, ...adjustment } },
      })
    } else {
      dispatch({ type: 'ADJUST_BALANCE', payload: { accountId, adjustment } })
    }
    handleClose()
  }

  function handleClose() {
    setForm({ ...emptyForm, date: today() })
    onClose()
  }

  const preview = baseBalance + getAdjustmentAmount()

  return (
    <Modal
      open={!!accountId}
      onClose={handleClose}
      title={
        account ? (
          <>
            {existing ? 'Edit Adjustment' : 'Adjust Balance'} —{' '}
            <AccountIcon name={account.icon} /> {account.name}
          </>
        ) : (
          'Adjust Balance'
        )
      }
    >
      <form onSubmit={handleSubmit}>
        <div
          className="form-group"
          style={{ marginBottom: 16 }}
        >
          <label>Current Balance</label>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: currentBalance >= 0 ? 'var(--success-text)' : 'var(--danger-text)',
            }}
          >
            {formatAmount(currentBalance, currency)}
          </div>
          {existing && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Includes this adjustment. Without it the balance is{' '}
              {formatAmount(baseBalance, currency)}.
            </span>
          )}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Date *</label>
            <input
              type="date"
              value={form.date}
              onChange={e => set('date', e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Adjustment Type *</label>
            <select value={form.type} onChange={e => set('type', e.target.value)}>
              <option value="add">Add to Balance</option>
              <option value="subtract">Subtract from Balance</option>
              <option value="set">Set Balance to</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Amount ({currency}) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={form.amount}
              onChange={e => set('amount', e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Reason</label>
            <input
              type="text"
              placeholder="e.g. Sales deposit"
              value={form.reason}
              onChange={e => set('reason', e.target.value)}
            />
          </div>
        </div>
        {form.amount && (
          <div
            style={{
              marginBottom: 16,
              padding: '12px 16px',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              fontSize: 14,
            }}
          >
            New balance:{' '}
            <strong
              className={preview >= 0 ? 'positive' : 'negative'}
              style={{ fontSize: 18 }}
            >
              {formatAmount(preview, currency)}
            </strong>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            {existing ? 'Save Changes' : 'Apply Adjustment'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
