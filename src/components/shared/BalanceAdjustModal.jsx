import { useState } from 'react'
import Modal from './Modal'
import AccountIcon from './AccountIcon'
import { useApp } from '../../hooks/useApp'
import { formatAmount, calculateAccountBalance } from '../../utils/helpers'

const today = () => new Date().toISOString().split('T')[0]
const emptyForm = { date: '', type: 'add', amount: '', reason: '' }

export default function BalanceAdjustModal({ accountId, onClose }) {
  const { state, dispatch } = useApp()
  const [form, setForm] = useState({ ...emptyForm, date: today() })

  const account = accountId ? state.accounts.find(a => a.id === accountId) : null
  const currency = account?.currency || 'MYR'
  const currentBalance = accountId
    ? calculateAccountBalance(
        accountId,
        state.accounts,
        state.expenses,
        state.sales,
        state.reloads
      )
    : 0

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
  }

  function getPreview() {
    const amount = parseFloat(form.amount) || 0
    if (form.type === 'add') return currentBalance + amount
    if (form.type === 'subtract') return currentBalance - amount
    if (form.type === 'set') return amount
    return currentBalance
  }

  function handleSubmit(e) {
    e.preventDefault()
    const amount = parseFloat(form.amount) || 0
    let adjustmentAmount = 0
    if (form.type === 'add') adjustmentAmount = amount
    else if (form.type === 'subtract') adjustmentAmount = -amount
    else if (form.type === 'set') adjustmentAmount = amount - currentBalance

    dispatch({
      type: 'ADJUST_BALANCE',
      payload: {
        accountId,
        adjustment: {
          date: form.date,
          amount: adjustmentAmount,
          reason: form.reason || 'Manual adjustment',
        },
      },
    })
    handleClose()
  }

  function handleClose() {
    setForm({ ...emptyForm, date: today() })
    onClose()
  }

  const preview = getPreview()

  return (
    <Modal
      open={!!accountId}
      onClose={handleClose}
      title={
        account ? (
          <>
            Adjust Balance — <AccountIcon name={account.icon} /> {account.name}
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
            Apply Adjustment
          </button>
        </div>
      </form>
    </Modal>
  )
}
