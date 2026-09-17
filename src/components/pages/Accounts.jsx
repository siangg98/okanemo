import { useState, useMemo } from 'react'
import {
  Pencil,
  Trash2,
  Coins,
  Wallet,
  ClipboardList,
  ArrowLeft,
  ArrowRightLeft,
} from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import {
  formatMYR,
  formatAmount,
  formatDate,
  calculateAccountBalance,
  calculateWalletValueMYR,
  buildTransactionList,
  accountUsage,
} from '../../utils/helpers'
import { CURRENCIES } from '../../utils/constants'
import { ACCOUNT_ICONS, DEFAULT_ACCOUNT_ICON } from '../../utils/accountIcons'
import EmptyState from '../shared/EmptyState'
import ConfirmModal from '../shared/ConfirmModal'
import FrozenValue from '../shared/FrozenValue'
import BalanceAdjustModal from '../shared/BalanceAdjustModal'
import TransferModal from '../shared/TransferModal'
import AccountIcon from '../shared/AccountIcon'
import Button from '../shared/Button'
import FormGroup from '../shared/FormGroup'
import DataTable from '../shared/DataTable'

const emptyAccountForm = { name: '', icon: DEFAULT_ACCOUNT_ICON, currency: 'MYR' }

// The slices accountUsage counts, named for an owner-facing message.
const USAGE_LABELS = {
  sales: 'sale',
  expenses: 'expense',
  reloads: 'reload',
  orders: 'order',
  shipments: 'shipment',
  transfers: 'transfer',
}

/** "3 sales, 1 expense" — the records that make an account load-bearing. */
function describeUsage(usage) {
  return Object.entries(usage?.counts || {})
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${n} ${USAGE_LABELS[key]}${n === 1 ? '' : 's'}`)
    .join(', ')
}

const TX_COLUMNS = [
  { label: 'Date' },
  { label: 'Type' },
  { label: 'Account' },
  { label: 'Amount' },
  { label: 'Description' },
  { label: 'Actions' },
]

export default function Accounts() {
  const { state, dispatch } = useApp()
  const [view, setView] = useState('list')
  const [editId, setEditId] = useState(null)
  const [accountForm, setAccountForm] = useState(emptyAccountForm)
  // Either closed, opening blank against an account (the card's own button) or
  // editing an adjustment off the ledger — the same shape the transfer modal
  // state uses, and for the same reason.
  const [adjust, setAdjust] = useState({ accountId: null, adjustmentId: null })
  const [confirmDelete, setConfirmDelete] = useState(null)
  // One object rather than three pieces of state: the transfer modal is either
  // closed, opening blank, opening with a From account already chosen (the
  // card's own button) or editing a transfer off the ledger.
  const [transfer, setTransfer] = useState({ open: false, transferId: null, fromAccountId: '' })
  const [confirmDeleteTransfer, setConfirmDeleteTransfer] = useState(null)
  // The ledger row itself, not just an id: it already carries the account, the
  // signed amount and the reason the message needs.
  const [confirmDeleteAdjustment, setConfirmDeleteAdjustment] = useState(null)

  // An account's currency stops being a label the moment anything references it
  // — see accountUsage for why changing it reinterprets history rather than
  // converting it.
  const usageFor = id =>
    accountUsage(id, {
      accounts: state.accounts,
      expenses: state.expenses,
      sales: state.sales,
      reloads: state.reloads,
      orders: state.orders,
      shipments: state.shipments,
      transfers: state.transfers,
    })

  const editUsage = editId ? usageFor(editId) : null
  const currencyLocked = !!editUsage?.hasHistory

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
      // Re-asserted rather than trusted to the form, which does not even render
      // the select once the account is referenced. Which figure the balance is
      // depends on the currency, so it cannot be a field value.
      dispatch({
        type: 'UPDATE_ACCOUNT',
        payload: {
          ...existing,
          ...accountForm,
          currency: currencyLocked ? existing.currency : accountForm.currency,
        },
      })
    } else {
      dispatch({ type: 'ADD_ACCOUNT', payload: { ...accountForm, isDefault: false } })
    }
    setView('list')
  }

  function handleDeleteAccount(account) {
    dispatch({ type: 'DELETE_ACCOUNT', payload: account.id })
  }

  function handleDeleteClick(account) {
    // Refuse rather than orphan. Six slices reference an account by id and none
    // of them carry their own currency, so deleting it leaves those records
    // pointing at nothing: they drop out of every balance and out of the
    // ledger, silently, with no way to reconnect them.
    const usage = usageFor(account.id)
    if (usage.hasHistory) {
      alert(
        `Cannot delete: ${describeUsage(usage)} use this account. Reassign or remove them first.`
      )
      return
    }
    setConfirmDelete(account)
  }

  function openAdjust(accountId) {
    setAdjust({ accountId, adjustmentId: null })
  }

  function openAdjustEdit(tx) {
    setAdjust({ accountId: tx.accountId, adjustmentId: tx.adjustmentId })
  }

  function closeAdjust() {
    setAdjust({ accountId: null, adjustmentId: null })
  }

  function openTransfer(fromAccountId = '') {
    setTransfer({ open: true, transferId: null, fromAccountId })
  }

  function openTransferEdit(transferId) {
    setTransfer({ open: true, transferId, fromAccountId: '' })
  }

  function closeTransfer() {
    setTransfer({ open: false, transferId: null, fromAccountId: '' })
  }

  const accountName = id => state.accounts.find(a => a.id === id)?.name || 'account'
  const balanceOf = id =>
    calculateAccountBalance(
      id,
      state.accounts,
      state.expenses,
      state.sales,
      state.reloads,
      state.transfers
    )
  const transferToDelete = state.transfers.find(t => t.id === confirmDeleteTransfer)
  // Names resolved through `accountName` so a transfer naming an account that
  // has since been deleted reads as plain text rather than "undefined".
  const deleteTransferMessage = transferToDelete
    ? `Delete this ${formatMYR(transferToDelete.amount)} transfer from ` +
      `${accountName(transferToDelete.fromAccountId)} to ` +
      `${accountName(transferToDelete.toAccountId)}? Both balances will be restored.`
    : ''

  // An adjustment is a signed delta, so removing it moves the balance by
  // exactly that much — worth spelling out, since the row shows the amount
  // unsigned and nothing else in the app writes the figure back.
  const deleteAdjustmentMessage = confirmDeleteAdjustment
    ? `Delete the ${confirmDeleteAdjustment.signedAmount >= 0 ? '+' : '−'}` +
      `${formatAmount(Math.abs(confirmDeleteAdjustment.signedAmount), confirmDeleteAdjustment.currency)} ` +
      `adjustment "${confirmDeleteAdjustment.description}" on ` +
      `${formatDate(confirmDeleteAdjustment.date)}? ` +
      `${accountName(confirmDeleteAdjustment.accountId)} goes to ` +
      `${formatAmount(
        balanceOf(confirmDeleteAdjustment.accountId) - confirmDeleteAdjustment.signedAmount,
        confirmDeleteAdjustment.currency
      )}.`
    : ''

  const transactions = useMemo(
    () =>
      buildTransactionList(
        state.accounts,
        state.expenses,
        state.sales,
        state.reloads,
        state.transfers
      ),
    [state.accounts, state.expenses, state.sales, state.reloads, state.transfers]
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
            <Button variant="secondary" onClick={() => openTransfer()}>
              <ArrowRightLeft className="icon-sm" /> Transfer
            </Button>
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
                state.reloads,
                state.transfers
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
                      <Button variant="icon" onClick={() => openAdjust(a.id)} title="Adjust Balance"><Coins /></Button>
                      {currency === 'MYR' && (
                        <Button variant="icon" onClick={() => openTransfer(a.id)} title="Transfer from this account"><ArrowRightLeft /></Button>
                      )}
                      {!a.isDefault && (
                        <Button variant="icon" delete onClick={() => handleDeleteClick(a)} title="Delete"><Trash2 /></Button>
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
              <td>
                {tx.transferId && (
                  <>
                    <Button
                      variant="icon"
                      onClick={() => openTransferEdit(tx.transferId)}
                      title="Edit transfer"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="icon"
                      delete
                      onClick={() => setConfirmDeleteTransfer(tx.transferId)}
                      title="Delete transfer"
                    >
                      <Trash2 />
                    </Button>
                  </>
                )}
                {tx.adjustmentId && (
                  <>
                    <Button
                      variant="icon"
                      onClick={() => openAdjustEdit(tx)}
                      title="Edit adjustment"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="icon"
                      delete
                      onClick={() => setConfirmDeleteAdjustment(tx)}
                      title="Delete adjustment"
                    >
                      <Trash2 />
                    </Button>
                  </>
                )}
              </td>
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
              required={!currencyLocked}
              hint={
                currencyLocked
                  ? `${describeUsage(editUsage)} are already denominated in ${accountForm.currency}. Changing it would reinterpret them rather than convert them — name and icon stay editable.`
                  : 'Non-MYR accounts are wallets that reloads top up'
              }
            >
              {currencyLocked ? (
                <FrozenValue>{accountForm.currency}</FrozenValue>
              ) : (
                <select
                  value={accountForm.currency}
                  onChange={e => setAccountForm(f => ({ ...f, currency: e.target.value }))}
                >
                  {CURRENCIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
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
      <BalanceAdjustModal
        accountId={adjust.accountId}
        adjustmentId={adjust.adjustmentId}
        onClose={closeAdjust}
      />
      <TransferModal
        open={transfer.open}
        transferId={transfer.transferId}
        fromAccountId={transfer.fromAccountId}
        onClose={closeTransfer}
      />
      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => handleDeleteAccount(confirmDelete)}
        title="Delete Account"
        message={
          confirmDelete
            ? `Delete account "${confirmDelete.name}"?` +
              ((confirmDelete.adjustments || []).length > 0
                ? ` Its ${confirmDelete.adjustments.length} balance adjustment(s) go with it.`
                : '')
            : ''
        }
      />
      <ConfirmModal
        open={!!confirmDeleteAdjustment}
        onClose={() => setConfirmDeleteAdjustment(null)}
        onConfirm={() =>
          dispatch({
            type: 'DELETE_ADJUSTMENT',
            payload: {
              accountId: confirmDeleteAdjustment.accountId,
              adjustmentId: confirmDeleteAdjustment.adjustmentId,
            },
          })
        }
        title="Delete Adjustment"
        message={deleteAdjustmentMessage}
      />
      <ConfirmModal
        open={!!confirmDeleteTransfer}
        onClose={() => setConfirmDeleteTransfer(null)}
        onConfirm={() => dispatch({ type: 'DELETE_TRANSFER', payload: confirmDeleteTransfer })}
        title="Delete Transfer"
        message={deleteTransferMessage}
      />
    </div>
  )
}
