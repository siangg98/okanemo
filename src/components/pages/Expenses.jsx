import { useState, useMemo } from 'react'
import { Download, AlertTriangle, Pencil, Trash2, Receipt, ArrowLeft } from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import {
  formatMYR,
  formatDate,
  formatForeign,
  formatRate,
  EXPENSE_CATEGORIES,
  isForeignExpense,
  drawFromReloads,
  restoreToReloads,
  calculateAccountBalance,
  exportCSV,
} from '../../utils/helpers'
import EmptyState from '../shared/EmptyState'
import ConfirmModal from '../shared/ConfirmModal'
import AccountIcon from '../shared/AccountIcon'
import Button from '../shared/Button'
import FormGroup from '../shared/FormGroup'
import DataTable from '../shared/DataTable'

const today = () => new Date().toISOString().split('T')[0]
const emptyForm = {
  date: '',
  description: '',
  category: 'other',
  amount: '',
  accountId: '',
  notes: '',
}

// Expenses cluster by account — local spending always comes off the bank, 1688
// spending always off the wallet — so the last one used is a better default
// than "no account", which is never the right answer. Kept out of STORAGE_KEYS
// deliberately: it is a UI preference, not a data slice to back up.
const LAST_ACCOUNT_KEY = 'okanemo_last_expense_account'

const EXPENSES_COLUMNS = [
  { label: 'Date' },
  { label: 'Description' },
  { label: 'Category' },
  { label: 'Amount' },
  { label: 'Account' },
  { label: 'Actions' },
]

export default function Expenses() {
  const { state, dispatch } = useApp()
  const [view, setView] = useState('list')
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  function openAdd() {
    setEditId(null)
    // Fall back to blank if the remembered account has since been deleted.
    const remembered = localStorage.getItem(LAST_ACCOUNT_KEY)
    const stillExists = state.accounts.some(a => a.id === remembered)
    setForm({ ...emptyForm, date: today(), accountId: stillExists ? remembered : '' })
    setView('form')
  }

  function openEdit(expense) {
    setEditId(expense.id)
    setForm({
      date: expense.date,
      description: expense.description,
      category: expense.category,
      // Foreign expenses are entered in their own currency — the MYR figure is
      // derived, so editing it directly would only be overwritten.
      amount: String(isForeignExpense(expense) ? expense.amountForeign : expense.amount),
      accountId: expense.accountId || '',
      notes: expense.notes || '',
    })
    setView('form')
  }

  function handleCancel() {
    setView('list')
    setEditId(null)
    setForm(emptyForm)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const typed = parseFloat(form.amount) || 0
    const payload = {
      date: form.date,
      description: form.description,
      category: form.category,
      accountId: form.accountId || null,
      notes: form.notes,
      currency,
      // Paid in yuan: store what actually left the wallet. `amount` is seeded
      // here but the wallet replay overwrites it with the MYR the drawn
      // reloads really cost — that is what removes the manual conversion.
      ...(isForeign ? { amountForeign: typed, amount: 0 } : { amount: typed }),
    }
    if (form.accountId) localStorage.setItem(LAST_ACCOUNT_KEY, form.accountId)
    if (editId) {
      dispatch({ type: 'UPDATE_EXPENSE', payload: { id: editId, ...payload } })
    } else {
      dispatch({ type: 'ADD_EXPENSE', payload })
    }
    handleCancel()
  }

  function handleDelete(expense) {
    dispatch({ type: 'DELETE_EXPENSE', payload: expense.id })
  }

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
  }

  // The account decides the currency — you cannot pay yuan from a bank account.
  const account = state.accounts.find(a => a.id === form.accountId)
  const currency = account?.currency || 'MYR'
  const isForeign = currency !== 'MYR'

  // Shown against each account in the picker, so you know what you are spending
  // from before you type an amount rather than after.
  const accountBalances = useMemo(() => {
    const balances = {}
    state.accounts.forEach(a => {
      const balance = calculateAccountBalance(
        a.id,
        state.accounts,
        state.expenses,
        state.sales,
        state.reloads
      )
      balances[a.id] =
        (a.currency || 'MYR') === 'MYR' ? formatMYR(balance) : formatForeign(balance, a.currency)
    })
    return balances
  }, [state.accounts, state.expenses, state.sales, state.reloads])

  // Preview the wallet draw. On edit, put this expense's own draw back first or
  // it would be counted twice.
  const previewPool = useMemo(() => {
    if (!editId) return state.reloads
    const existing = state.expenses.find(e => e.id === editId)
    return restoreToReloads(state.reloads, existing?.reloadDraws)
  }, [editId, state.reloads, state.expenses])

  const preview = isForeign
    ? drawFromReloads(previewPool, form.accountId, parseFloat(form.amount) || 0)
    : null

  const filtered = useMemo(() => {
    let list = [...state.expenses].sort((a, b) => new Date(b.date) - new Date(a.date))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        e =>
          e.description.toLowerCase().includes(q) ||
          (EXPENSE_CATEGORIES[e.category] || e.category).toLowerCase().includes(q)
      )
    }
    if (filterMonth) {
      list = list.filter(e => e.date.startsWith(filterMonth))
    }
    return list
  }, [state.expenses, search, filterMonth])

  const totalFiltered = filtered.filter(e => e.category !== 'inventory').reduce((sum, e) => sum + e.amount, 0)

  function handleExportCSV() {
    const rows = filtered.map(e => {
      const account = e.accountId
        ? state.accounts.find(a => a.id === e.accountId)
        : null
      return {
        Date: e.date,
        Description: e.description,
        Category: EXPENSE_CATEGORIES[e.category] || e.category,
        'Amount (RM)': e.amount.toFixed(2),
        Currency: e.currency || 'MYR',
        'Amount (paid)': isForeignExpense(e) ? e.amountForeign.toFixed(2) : e.amount.toFixed(2),
        Rate: isForeignExpense(e) ? (e.rateMYR || 0).toFixed(6) : '',
        Account: account ? account.name : '',
        Notes: e.notes || '',
      }
    })
    exportCSV(`okanemo-expenses-${new Date().toISOString().split('T')[0]}.csv`, rows)
  }

  return (
    <div>
      <div className={`tab-list-view${view === 'form' ? ' hidden' : ''}`}>
        <div className="page-header">
          <div className="page-header-row">
            <h1>Expenses</h1>
            <div style={{ display: 'flex', gap: 8 }}>
              {filtered.length > 0 && (
                <Button variant="secondary" onClick={handleExportCSV}>
                  <Download className="icon-btn" /> Export CSV
                </Button>
              )}
              <Button variant="primary" onClick={openAdd}>+ Add Expense</Button>
            </div>
          </div>
        </div>

        <div className="filter-bar">
          <input
            type="text"
            className="search-input"
            placeholder="Search expenses…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <input
            type="month"
            className="date-input"
            value={filterMonth}
            onChange={e => setFilterMonth(e.target.value)}
          />
          {(search || filterMonth) && (
            <Button variant="clear" onClick={() => { setSearch(''); setFilterMonth('') }}>
              Clear
            </Button>
          )}
        </div>

        <DataTable
          columns={EXPENSES_COLUMNS}
          data={filtered}
          renderRow={e => {
            const account = e.accountId
              ? state.accounts.find(a => a.id === e.accountId)
              : null
            return (
              <tr key={e.id}>
                <td>{formatDate(e.date)}</td>
                <td>{e.description}</td>
                <td>{EXPENSE_CATEGORIES[e.category] || e.category}</td>
                <td className="negative">
                  {formatMYR(e.amount)}
                  {isForeignExpense(e) && (
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>
                      {formatForeign(e.amountForeign, e.currency)}
                      {e.rateMYR > 0 && ` @ ${formatRate(e.rateMYR, e.currency)}`}
                      {e.shortfallForeign > 0 && (
                        <span
                          title={`Wallet was short by ${formatForeign(e.shortfallForeign, e.currency)} — estimated at the latest rate`}
                          style={{ cursor: 'help' }}
                        >
                          {' '}
                          <AlertTriangle className="icon-sm" style={{ color: 'var(--warning-text, #b45309)' }} />
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td>
                  {account ? <><AccountIcon name={account.icon} /> {account.name}</> : '—'}
                </td>
                <td>
                  <Button variant="icon" onClick={() => openEdit(e)} title="Edit"><Pencil /></Button>
                  <Button variant="icon" delete onClick={() => setConfirmDelete(e)} title="Delete"><Trash2 /></Button>
                </td>
              </tr>
            )
          }}
          emptyState={
            <EmptyState
              icon={Receipt}
              message={
                state.expenses.length === 0
                  ? 'No expenses yet. Add your first expense.'
                  : 'No expenses match your filter.'
              }
            />
          }
        />

        {filtered.length > 0 && (
          <div style={{ textAlign: 'right', marginTop: 8, fontSize: 14, color: 'var(--text-secondary)' }}>
            Total: <strong className="negative">{formatMYR(totalFiltered)}</strong>
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => handleDelete(confirmDelete)}
        title="Delete Expense"
        message={`Delete expense "${confirmDelete?.description}"?`}
      />

      <div className={`tab-form-view${view === 'form' ? ' active' : ''}`}>
        <div className="form-view-header">
          <Button variant="back" onClick={handleCancel}><ArrowLeft /></Button>
          <h1>{editId ? 'Edit Expense' : 'Add Expense'}</h1>
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
            <FormGroup label="Category" required>
              <select value={form.category} onChange={e => set('category', e.target.value)} required>
                {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </FormGroup>
          </div>
          <div className="form-row">
            <FormGroup label="Description" required>
              <input
                type="text"
                placeholder="What was this expense for?"
                value={form.description}
                onChange={e => set('description', e.target.value)}
                required
              />
            </FormGroup>
            <FormGroup label="Account" hint="Picking a wallet records the expense in its currency">
              <select value={form.accountId} onChange={e => set('accountId', e.target.value)}>
                <option value="">— No account —</option>
                {state.accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency || 'MYR'}) · {accountBalances[a.id]}
                  </option>
                ))}
              </select>
            </FormGroup>
          </div>
          <div className="form-row">
            <FormGroup
              label={`Amount (${isForeign ? currency : 'RM'})`}
              required
              hint={isForeign ? 'What you actually paid — the MYR is worked out below' : undefined}
            >
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
            <FormGroup label="Notes">
              <input
                type="text"
                placeholder="Optional notes"
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
              />
            </FormGroup>
          </div>

          {isForeign && (
            <div
              style={{
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                margin: '16px 0',
                fontSize: 13,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Draws from {preview.draws.length || 0} reload
                  {preview.draws.length === 1 ? '' : 's'}
                  {preview.rateMYR > 0 && ` @ ${formatRate(preview.rateMYR, currency)}`}
                </span>
                <strong style={{ color: 'var(--accent-text)' }}>
                  {formatMYR((parseFloat(form.amount) || 0) * preview.rateMYR)}
                </strong>
              </div>
              {preview.shortfall > 0 && (
                <div style={{ color: 'var(--danger-text)' }}>
                  <AlertTriangle className="icon-btn" /> Wallet is short by{' '}
                  {formatForeign(preview.shortfall, currency)} — add a reload, or this much is
                  estimated at your latest rate.
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button variant="primary" type="submit">
              {editId ? 'Save Changes' : 'Add Expense'}
            </Button>
            <Button variant="secondary" type="button" onClick={handleCancel}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
