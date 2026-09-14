import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import AccountIcon from './AccountIcon'
import FormGroup from './FormGroup'
import { useApp } from '../../hooks/useApp'
import { formatMYR, calculateAccountBalance } from '../../utils/helpers'

const today = () => new Date().toISOString().split('T')[0]
const emptyForm = { date: '', fromAccountId: '', toAccountId: '', amount: '', notes: '' }

/**
 * Move money between two MYR accounts.
 *
 * MYR only, deliberately. A wallet's balance *is* the reload pool:
 * `calculateAccountBalance` reads `remainingForeign` off the reloads paid into
 * it, and `recomputeReloadDraws` rebuilds that figure from reloads, orders and
 * expenses alone. Money parked in a wallet by any other route would therefore
 * show in the balance but could never be spent by an order — the books would
 * claim funds the FIFO draw cannot see. Buying foreign currency is a reload,
 * and the Reloads page already owns the MYR → wallet direction; cashing a
 * wallet back out needs the pool itself reworked, not a ledger entry.
 *
 * So a transfer stays inside MYR, where both legs are plain ledger amounts.
 * This modal is the only thing that dispatches the transfer actions, which is
 * why the constraint can live here rather than in the reducer.
 */
export default function TransferModal({ open, transferId, fromAccountId, onClose }) {
  const { state, dispatch } = useApp()
  const [form, setForm] = useState({ ...emptyForm, date: today() })

  // Wallets are excluded at the source, not filtered somewhere downstream, so
  // nothing else has to re-check what a transfer is allowed to name.
  const myrAccounts = useMemo(
    () => state.accounts.filter(a => (a.currency || 'MYR') === 'MYR'),
    [state.accounts]
  )

  const existing = transferId ? state.transfers.find(t => t.id === transferId) : null

  // Re-seed on every open. One component serves the page button, the per-card
  // "transfer from this account" button and the edit button on a history row,
  // so the form cannot be initialised once at mount.
  useEffect(() => {
    if (!open) return
    setForm(
      existing
        ? {
            date: existing.date,
            fromAccountId: existing.fromAccountId,
            toAccountId: existing.toAccountId,
            amount: String(existing.amount ?? ''),
            notes: existing.notes || '',
          }
        : { ...emptyForm, date: today(), fromAccountId: fromAccountId || '' }
    )
  }, [open, existing, fromAccountId])

  // Balances as they stand *without* the transfer being edited — otherwise its
  // own amount is already counted on both sides and every save looks like a
  // change that did nothing.
  const pool = useMemo(
    () => state.transfers.filter(t => t.id !== transferId),
    [state.transfers, transferId]
  )

  const balanceOf = id =>
    calculateAccountBalance(id, state.accounts, state.expenses, state.sales, state.reloads, pool)

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
  }

  // The To list leaves out the From account, so moving From onto the current To
  // would strand a value no option offers — a transfer out of and into the same
  // account, which would net to nothing and read as a no-op.
  function handleFromChange(id) {
    setForm(f => ({
      ...f,
      fromAccountId: id,
      toAccountId: f.toAccountId === id ? '' : f.toAccountId,
    }))
  }

  const amount = parseFloat(form.amount) || 0
  const from = myrAccounts.find(a => a.id === form.fromAccountId)
  const to = myrAccounts.find(a => a.id === form.toAccountId)
  const fromAfter = from ? balanceOf(from.id) - amount : 0
  const toAfter = to ? balanceOf(to.id) + amount : 0
  const canSubmit =
    !!form.date &&
    !!form.fromAccountId &&
    !!form.toAccountId &&
    form.fromAccountId !== form.toAccountId &&
    amount > 0

  function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    const payload = {
      date: form.date,
      fromAccountId: form.fromAccountId,
      toAccountId: form.toAccountId,
      amount,
      notes: form.notes,
    }
    if (existing) {
      dispatch({ type: 'UPDATE_TRANSFER', payload: { id: existing.id, ...payload } })
    } else {
      dispatch({ type: 'ADD_TRANSFER', payload })
    }
    handleClose()
  }

  function handleClose() {
    setForm({ ...emptyForm, date: today() })
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title={existing ? 'Edit Transfer' : 'Transfer Money'}>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <FormGroup label="Date" required>
            <input
              type="date"
              value={form.date}
              onChange={e => set('date', e.target.value)}
              required
            />
          </FormGroup>
          <FormGroup label="Amount (RM)" required>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={form.amount}
              onChange={e => set('amount', e.target.value)}
              required
            />
          </FormGroup>
        </div>

        <div className="form-row">
          <FormGroup label="From" required hint="The MYR account the money leaves">
            <select
              value={form.fromAccountId}
              onChange={e => handleFromChange(e.target.value)}
              required
            >
              <option value="">— Select account —</option>
              {myrAccounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name} · {formatMYR(balanceOf(a.id))}
                </option>
              ))}
            </select>
          </FormGroup>
          <FormGroup
            label="To"
            required
            hint={
              myrAccounts.length < 2
                ? 'Add a second MYR account under Accounts first'
                : 'The MYR account it lands in'
            }
          >
            <select
              value={form.toAccountId}
              onChange={e => set('toAccountId', e.target.value)}
              required
            >
              <option value="">— Select account —</option>
              {myrAccounts
                .filter(a => a.id !== form.fromAccountId)
                .map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {formatMYR(balanceOf(a.id))}
                  </option>
                ))}
            </select>
          </FormGroup>
        </div>

        <FormGroup label="Notes">
          <input
            type="text"
            placeholder="e.g. Top up e-wallet"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
          />
        </FormGroup>

        {from && to && amount > 0 && (
          <div
            style={{
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              marginBottom: 20,
              fontSize: 13,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 11,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              Balance after
            </span>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>
                <AccountIcon name={from.icon} /> {from.name}
              </span>
              <strong className={fromAfter >= 0 ? 'positive' : 'negative'}>
                {formatMYR(fromAfter)}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>
                <AccountIcon name={to.icon} /> {to.name}
              </span>
              <strong className={toAfter >= 0 ? 'positive' : 'negative'}>
                {formatMYR(toAfter)}
              </strong>
            </div>
            {fromAfter < 0 && (
              <span style={{ color: 'var(--warning-text)' }}>
                {from.name} would go negative. The transfer is still recorded — the same as a
                balance adjustment that takes an account below zero.
              </span>
            )}
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              A transfer only moves money, so neither balance is an expense.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!canSubmit}>
            {existing ? 'Save Changes' : 'Transfer'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
