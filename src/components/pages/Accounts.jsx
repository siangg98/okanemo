import { useState, useMemo } from 'react'
import { Pencil, Trash2, Coins, Wallet, ClipboardList, ArrowLeft } from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import {
  formatMYR,
  formatAmount,
  formatDate,
  calculateAccountBalance,
  calculateWalletValueMYR,
  buildTransactionList,
} from '../../utils/helpers'
import { CURRENCIES } from '../../utils/constants'
import { ACCOUNT_ICONS, DEFAULT_ACCOUNT_ICON } from '../../utils/accountIcons'
import EmptyState from '../shared/EmptyState'
import ConfirmModal from '../shared/ConfirmModal'
import BalanceAdjustModal from '../shared/BalanceAdjustModal'
import AccountIcon from '../shared/AccountIcon'
import Button from '../shared/Button'
import FormGroup from '../shared/FormGroup'
import DataTable from '../shared/DataTable'

const emptyAccountForm = { name: '', icon: DEFAULT_ACCOUNT_ICON, currency: 'MYR' }

const TX_COLUMNS = [
  { label: 'Date' },
  { label: 'Type' },
  { label: 'Account' },
  { label: 'Amount' },
  { label: 'Description' },
]

export default function Accounts() {
  const { state, dispatch } = useApp()
  const [view, setView] = useState('list')
  const [editId, setEditId] = useState(null)
  const [accountForm, setAccountForm] = useState(emptyAccountForm)
  const [adjustAccountId, setAdjustAccountId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  function openAdd() {
    setEditId(null)
    setAccountForm(emptyAccountForm)
    setView('form')
  }

  function openEdit(account) {
    setEditId(account.id)
    setAccountForm({
      name: account.name,
      icon: account.icon,
      currency: account.currency || 'MYR',
    })
    setView('form')
  }

  function handleAccountSubmit(e) {
    e.preventDefault()
    if (editId) {
      const existing = state.accounts.find(a => a.id === editId)
      dispatch({ type: 'UPDATE_ACCOUNT', payload: { ...existing, ...accountForm } })
    } else {
      dispatch({ type: 'ADD_ACCOUNT', payload: { ...accountForm, isDefault: false } })
    }
    setView('list')
  }

  function handleDeleteAccount(account) {
    dispatch({ type: 'DELETE_ACCOUNT', payload: account.id })
  }

  const transactions = useMemo(
    () => buildTransactionList(state.accounts, state.expenses, state.sales, state.reloads),
    [state.accounts, state.expenses, state.sales, state.reloads]
  )

  // Transaction rows carry only accountId — the name is plain text so it can go
  // into a CSV, so the icon is looked up here instead.
  const iconByAccount = useMemo(
    () => new Map(state.accounts.map(a => [a.id, a.icon])),
    [state.accounts]
  )

  return (
    <div>
      {/* List View */}
      <div className={`tab-list-view${view !== 'list' ? ' hidden' : ''}`}>
        <div className="page-header">
          <div className="page-header-row">
            <h1>Accounts</h1>
            <Button variant="primary" onClick={openAdd}>+ Add Account</Button>
          </div>
        </div>

        {state.accounts.length === 0 ? (
          <EmptyState icon={Wallet} message="No accounts yet." />
        ) : (
          <div className="accounts-grid">
            {state.accounts.map(a => {
              const currency = a.currency || 'MYR'
              const balance = calculateAccountBalance(
                a.id,
                state.accounts,
                state.expenses,
                state.sales,
                state.reloads
              )
              const atCostMYR =
                currency === 'MYR' ? null : calculateWalletValueMYR(a.id, state.reloads)
              return (
                <div key={a.id} className="account-card">
                  <div className="account-header">
                    <span className="account-icon">
                      <AccountIcon name={a.icon} className="" />
                    </span>
                    <div className="account-info">
                      <h3>{a.name}</h3>
                    </div>
                    <div className="account-actions">
                      <Button variant="icon" onClick={() => openEdit(a)} title="Edit"><Pencil /></Button>
                      <Button variant="icon" onClick={() => setAdjustAccountId(a.id)} title="Adjust Balance"><Coins /></Button>
                      {!a.isDefault && (
                        <Button variant="icon" delete onClick={() => setConfirmDelete(a)} title="Delete"><Trash2 /></Button>
                      )}
                    </div>
                  </div>
                  <div className="account-balance">
                    <span className="balance-label">
                      Balance{currency !== 'MYR' && ` (${currency})`}
                    </span>
                    <span className={`balance-value ${balance >= 0 ? 'positive' : 'negative'}`}>
                      {formatAmount(balance, currency)}
                    </span>
                    {atCostMYR !== null && (
                      <span
                        style={{
                          display: 'block',
                          marginTop: 4,
                          fontSize: 12,
                          color: 'var(--text-muted)',
                        }}
                      >
                        ≈ {formatMYR(atCostMYR)} at cost
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <h2 style={{ fontSize: 16, fontWeight: 600, margin: '24px 0 12px', color: 'var(--text-primary)' }}>
          Transaction History
        </h2>

        <DataTable
          columns={TX_COLUMNS}
          data={transactions}
          renderRow={tx => (
            <tr key={tx.id}>
              <td>{formatDate(tx.date)}</td>
              <td style={{ textTransform: 'capitalize' }}>{tx.type}</td>
              <td>
                <AccountIcon name={iconByAccount.get(tx.accountId)} /> {tx.accountName}
              </td>
              <td className={tx.isPositive ? 'positive' : 'negative'}>
                {tx.isPositive ? '+' : '−'}{formatAmount(tx.amount, tx.currency)}
              </td>
              <td>{tx.description}</td>
            </tr>
          )}
          emptyState={<EmptyState icon={ClipboardList} message="No transactions yet." />}
        />
      </div>

      {/* Account Add/Edit Form */}
      <div className={`tab-form-view${view === 'form' ? ' active' : ''}`}>
        <div className="form-view-header">
          <Button variant="back" onClick={() => setView('list')}><ArrowLeft /></Button>
          <h1>{editId ? 'Edit Account' : 'Add Account'}</h1>
        </div>
        <form onSubmit={handleAccountSubmit}>
          <div className="form-row">
            <FormGroup label="Account Name" required>
              <input
                type="text"
                placeholder="e.g. Bank Account"
                value={accountForm.name}
                onChange={e => setAccountForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </FormGroup>
          </div>
          <div className="form-row">
            <FormGroup label="Icon" required>
              <div className="icon-picker" role="radiogroup" aria-label="Account icon">
                {ACCOUNT_ICONS.map(({ name, label, Icon }) => (
                  <button
                    key={name}
                    type="button"
                    className={`icon-picker-option${accountForm.icon === name ? ' selected' : ''}`}
                    onClick={() => setAccountForm(f => ({ ...f, icon: name }))}
                    role="radio"
                    aria-checked={accountForm.icon === name}
                    title={label}
                  >
                    <Icon />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </FormGroup>
          </div>
          <div className="form-row">
            <FormGroup
              label="Currency"
              required
              hint="Non-MYR accounts are wallets that reloads top up"
            >
              <select
                value={accountForm.currency}
                onChange={e => setAccountForm(f => ({ ...f, currency: e.target.value }))}
              >
                {CURRENCIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </FormGroup>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button variant="primary" type="submit">
              {editId ? 'Save Changes' : 'Add Account'}
            </Button>
            <Button variant="secondary" type="button" onClick={() => setView('list')}>Cancel</Button>
          </div>
        </form>
      </div>

      {/* Modals */}
      <BalanceAdjustModal accountId={adjustAccountId} onClose={() => setAdjustAccountId(null)} />
      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => handleDeleteAccount(confirmDelete)}
        title="Delete Account"
        message={`Delete account "${confirmDelete?.name}"?`}
      />
    </div>
  )
}
