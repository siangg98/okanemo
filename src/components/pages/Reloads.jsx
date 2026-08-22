import { useState, useMemo } from 'react'
import {
  Coins,
  Lock,
  Scale,
  Percent,
  Pencil,
  Trash2,
  ArrowRight,
  ArrowLeft,
  ArrowRightLeft,
} from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import {
  formatMYR,
  formatDate,
  formatForeign,
  formatRate,
  calculateReloadTotalMYR,
  calculateReloadCostRate,
  calculateReloadConvertedMYR,
  calculateReloadFeesMYR,
  calculateWallet,
} from '../../utils/helpers'
import { CURRENCIES, DEFAULT_FOREIGN_CURRENCY } from '../../utils/constants'
import EmptyState from '../shared/EmptyState'
import ConfirmModal from '../shared/ConfirmModal'
import AccountIcon from '../shared/AccountIcon'
import Button from '../shared/Button'
import FormGroup from '../shared/FormGroup'
import DataTable from '../shared/DataTable'
import StatCard from '../shared/StatCard'

const today = () => new Date().toISOString().split('T')[0]

// A reload converts MYR into something else, so MYR itself is not an option.
const FOREIGN_CURRENCIES = CURRENCIES.filter(c => c !== 'MYR')

const RELOAD_COLUMNS = [
  { label: 'Date' },
  { label: 'Received' },
  { label: 'Total Paid (RM)' },
  { label: 'Fees' },
  { label: 'Effective Rate' },
  { label: 'Remaining' },
  { label: <>Paid From <ArrowRight className="icon-sm" /> Into</> },
  { label: 'Actions' },
]

function emptyForm(accountId = '', walletAccountId = '') {
  return {
    date: today(),
    currency: DEFAULT_FOREIGN_CURRENCY,
    amountForeign: '',
    myrPaid: '',
    agentFeeMYR: '',
    bankFeeMYR: '',
    accountId,
    walletAccountId,
    notes: '',
  }
}

export default function Reloads() {
  const { state, dispatch } = useApp()
  const [view, setView] = useState('list')
  const [editId, setEditId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [form, setForm] = useState(emptyForm())

  const wallet = useMemo(
    () => calculateWallet(state.reloads, DEFAULT_FOREIGN_CURRENCY),
    [state.reloads]
  )

  const sortedReloads = useMemo(
    () => [...state.reloads].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [state.reloads]
  )

  // A reload moves value from an MYR account into a wallet of the chosen currency
  const payFromAccounts = state.accounts.filter(a => (a.currency || 'MYR') === 'MYR')
  const walletAccounts = state.accounts.filter(a => a.currency === form.currency)

  function openAdd() {
    setEditId(null)
    const payFrom = state.accounts.find(a => a.isDefault && (a.currency || 'MYR') === 'MYR')
    const wallet = state.accounts.find(a => a.currency === DEFAULT_FOREIGN_CURRENCY)
    setForm(emptyForm(payFrom?.id || '', wallet?.id || ''))
    setView('form')
  }

  function openEdit(reload) {
    setEditId(reload.id)
    setForm({
      date: reload.date,
      currency: reload.currency || DEFAULT_FOREIGN_CURRENCY,
      amountForeign: String(reload.amountForeign ?? ''),
      myrPaid: String(reload.myrPaid ?? ''),
      agentFeeMYR: reload.agentFeeMYR ? String(reload.agentFeeMYR) : '',
      bankFeeMYR: reload.bankFeeMYR ? String(reload.bankFeeMYR) : '',
      accountId: reload.accountId || '',
      walletAccountId: reload.walletAccountId || '',
      notes: reload.notes || '',
    })
    setView('form')
  }

  function handleCancel() {
    setView('list')
    setEditId(null)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const payload = {
      date: form.date,
      currency: form.currency,
      amountForeign: parseFloat(form.amountForeign) || 0,
      myrPaid: parseFloat(form.myrPaid) || 0,
      agentFeeMYR: parseFloat(form.agentFeeMYR) || 0,
      bankFeeMYR: parseFloat(form.bankFeeMYR) || 0,
      // Always true — the marker migrateReloadFeesInclusive uses to tell a
      // normalised record from a legacy additive one.
      feesIncluded: true,
      accountId: form.accountId || null,
      walletAccountId: form.walletAccountId || null,
      notes: form.notes,
    }
    if (editId) {
      dispatch({ type: 'UPDATE_RELOAD', payload: { id: editId, ...payload } })
    } else {
      dispatch({ type: 'ADD_RELOAD', payload })
    }
    handleCancel()
  }

  function handleDelete(reload) {
    dispatch({ type: 'DELETE_RELOAD', payload: reload.id })
  }

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  // Switching currency invalidates the chosen wallet — point at a matching one
  function setCurrency(currency) {
    const wallet = state.accounts.find(a => a.currency === currency)
    setForm(f => ({ ...f, currency, walletAccountId: wallet?.id || '' }))
  }

  // Live preview of what this reload really costs
  const preview = {
    totalMYR: calculateReloadTotalMYR(form),
    costRate: calculateReloadCostRate(form),
  }
  const feesMYR = calculateReloadFeesMYR(form)
  const convertedMYR = calculateReloadConvertedMYR(form)
  // The agent's headline rate is quoted against what actually converted — the
  // outlay less its fees, not the outlay.
  const quotedRate =
    (parseFloat(form.amountForeign) || 0) > 0
      ? convertedMYR / (parseFloat(form.amountForeign) || 1)
      : 0

  const deleteSpent = confirmDelete
    ? (confirmDelete.amountForeign || 0) - (confirmDelete.remainingForeign || 0)
    : 0

  return (
    <div>
      {/* List View */}
      <div className={`tab-list-view${view === 'form' ? ' hidden' : ''}`}>
        <div className="page-header">
          <div className="page-header-row">
            <h1>Reloads</h1>
            <Button variant="primary" onClick={openAdd}>+ Add Reload</Button>
          </div>
        </div>

        {/* Wallet */}
        <div className="stats-grid cols-4" style={{ marginBottom: 16 }}>
          <StatCard
            icon={Coins}
            iconClass="investment"
            label={`${wallet.currency} Remaining`}
            value={formatForeign(wallet.remainingForeign, wallet.currency)}
          />
          <StatCard
            icon={Lock}
            iconClass="fees"
            label="RM Tied Up"
            value={formatMYR(wallet.tiedUpMYR)}
          />
          <StatCard
            icon={Scale}
            iconClass="revenue"
            label="Blended Rate"
            value={wallet.blendedRate > 0 ? formatRate(wallet.blendedRate, wallet.currency) : '—'}
          />
          <StatCard
            icon={Percent}
            iconClass="profit"
            label="Agent + Bank Fees"
            value={formatMYR(wallet.totalFeesMYR)}
          />
        </div>

        <DataTable
          columns={RELOAD_COLUMNS}
          data={sortedReloads}
          renderRow={r => {
            const fees = calculateReloadFeesMYR(r)
            const from = state.accounts.find(a => a.id === r.accountId)
            const to = state.accounts.find(a => a.id === r.walletAccountId)
            const remaining = r.remainingForeign || 0
            const isSpent = remaining <= 0
            return (
              <tr key={r.id}>
                <td>{formatDate(r.date)}</td>
                <td>{formatForeign(r.amountForeign, r.currency)}</td>
                <td>{formatMYR(calculateReloadTotalMYR(r))}</td>
                <td>{fees > 0 ? formatMYR(fees) : '—'}</td>
                <td>{formatRate(calculateReloadCostRate(r), r.currency)}</td>
                <td className={isSpent ? '' : 'positive'}>
                  {formatForeign(remaining, r.currency)}
                </td>
                <td>
                  {from ? <><AccountIcon name={from.icon} /> {from.name}</> : '—'}
                  <ArrowRight className="icon-sm" style={{ margin: '0 6px', color: 'var(--text-muted)' }} />
                  {to ? <><AccountIcon name={to.icon} /> {to.name}</> : '—'}
                </td>
                <td>
                  <Button variant="icon" onClick={() => openEdit(r)} title="Edit"><Pencil /></Button>
                  <Button variant="icon" delete onClick={() => setConfirmDelete(r)} title="Delete"><Trash2 /></Button>
                </td>
              </tr>
            )
          }}
          emptyState={
            <EmptyState icon={ArrowRightLeft} message="No reloads yet. Add one when you top up with your agent." />
          }
        />
      </div>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => handleDelete(confirmDelete)}
        title="Delete Reload"
        message={
          deleteSpent > 0
            ? `This reload has already been drawn on (${formatForeign(deleteSpent, confirmDelete?.currency)} spent). Deleting it will shrink your wallet balance and refund the transfer to your bank account. Continue?`
            : `Delete this reload of ${formatForeign(confirmDelete?.amountForeign, confirmDelete?.currency)}? The transfer will be reversed on both accounts.`
        }
      />

      {/* Reload Form */}
      <div className={`tab-form-view${view === 'form' ? ' active' : ''}`}>
        <div className="form-view-header">
          <Button variant="back" onClick={handleCancel}><ArrowLeft /></Button>
          <h1>{editId ? 'Edit Reload' : 'Add Reload'}</h1>
        </div>
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
            <FormGroup label="Currency" required>
              <select value={form.currency} onChange={e => setCurrency(e.target.value)}>
                {FOREIGN_CURRENCIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </FormGroup>
          </div>

          <div className="form-row">
            <FormGroup
              label={`Amount Received (${form.currency})`}
              required
              hint="How much foreign currency the agent transferred to you"
            >
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 2000"
                value={form.amountForeign}
                onChange={e => set('amountForeign', e.target.value)}
                required
              />
            </FormGroup>
            <FormGroup
              label="Total Paid (RM)"
              required
              hint="The full amount that left your bank, fees included"
            >
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 1280.00"
                value={form.myrPaid}
                onChange={e => set('myrPaid', e.target.value)}
                required
              />
            </FormGroup>
          </div>

          <div className="form-row">
            <FormGroup
              label="Agent Fee (RM)"
              hint="Service charge taken out of the total paid, if any"
            >
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={form.agentFeeMYR}
                onChange={e => set('agentFeeMYR', e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Bank Transfer Fee (RM)" hint="What your bank charged for the transfer">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={form.bankFeeMYR}
                onChange={e => set('bankFeeMYR', e.target.value)}
              />
            </FormGroup>
          </div>

          <div className="form-row">
            <FormGroup
              label="Paid From"
              required
              hint="The MYR account the transfer left"
            >
              <select
                value={form.accountId}
                onChange={e => set('accountId', e.target.value)}
                required
              >
                <option value="">— Select account —</option>
                {payFromAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </FormGroup>
            <FormGroup
              label="Received Into"
              required
              hint={
                walletAccounts.length > 0
                  ? `The ${form.currency} wallet the agent topped up`
                  : `No ${form.currency} account yet — create one under Accounts`
              }
            >
              <select
                value={form.walletAccountId}
                onChange={e => set('walletAccountId', e.target.value)}
                required
              >
                <option value="">— Select wallet —</option>
                {walletAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </FormGroup>
          </div>

          <div className="form-row">
            <FormGroup label="Notes">
              <input
                type="text"
                placeholder="e.g. August top-up"
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
              />
            </FormGroup>
          </div>

          {/* Live cost summary */}
          <div
            style={{
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              marginBottom: 16,
              fontSize: 13,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Total out of account</span>
              <span>{formatMYR(preview.totalMYR)}</span>
            </div>
            {feesMYR > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Fees</span>
                <span>− {formatMYR(feesMYR)}</span>
              </div>
            )}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '1px solid var(--border-color)',
                paddingTop: 6,
                fontWeight: 600,
              }}
            >
              <span>Converted to {form.currency}</span>
              <span>{formatMYR(convertedMYR)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 2 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Quoted rate</span>
              <span>{quotedRate > 0 ? formatRate(quotedRate, form.currency) : '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                Effective rate <em style={{ fontStyle: 'normal', color: 'var(--text-muted)' }}>(what a {form.currency} really costs you)</em>
              </span>
              <strong style={{ color: 'var(--accent-text)' }}>
                {preview.costRate > 0 ? formatRate(preview.costRate, form.currency) : '—'}
              </strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" type="submit">
              {editId ? 'Save Changes' : 'Add Reload'}
            </Button>
            <Button variant="secondary" type="button" onClick={handleCancel}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
