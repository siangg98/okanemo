import { useState, useMemo } from 'react'
import { Download, Pencil, Trash2, ShoppingCart, ArrowLeft, X } from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import { generateId } from '../../utils/helpers'
import {
  formatMYR,
  formatDate,
  calculateSaleTotals,
  calculateProductCostPerUnit,
  calculateStock,
  calculateVariationStock,
  calculateVariationCostPerUnit,
  getVariationLabel,
  getProductsSummary,
  getTotalQuantity,
} from '../../utils/helpers'
import EmptyState from '../shared/EmptyState'
import ConfirmModal from '../shared/ConfirmModal'
import Button from '../shared/Button'
import FormGroup from '../shared/FormGroup'
import DataTable from '../shared/DataTable'
import { exportCSV } from '../../utils/helpers'

const today = () => new Date().toISOString().split('T')[0]
const emptyFees = { commission: '', transaction: '', service: '', saver: '', voucher: '' }
const newItem = () => ({ _id: generateId(), productId: '', variationId: '', quantity: 1 })

const SALES_COLUMNS = [
  { label: 'Date' },
  { label: 'Reference' },
  { label: 'Products' },
  { label: 'Qty' },
  { label: 'Selling Price' },
  { label: 'Fees' },
  { label: 'Net Revenue' },
  { label: 'Profit' },
  { label: 'Actions' },
]

export default function Sales() {
  const { state, dispatch } = useApp()
  const [view, setView] = useState('list')
  const [editId, setEditId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const defaultAccountId =
    (state.accounts.find(a => a.isDefault) || state.accounts[0])?.id || ''

  const [form, setForm] = useState({
    date: today(),
    reference: '',
    sellingPrice: '',
    items: [newItem()],
    fees: { ...emptyFees },
    saverEnabled: false,
    accountId: defaultAccountId,
  })

  function resetForm() {
    setForm({
      date: today(),
      reference: '',
      sellingPrice: '',
      items: [newItem()],
      fees: { ...emptyFees },
      saverEnabled: false,
      accountId: defaultAccountId,
    })
  }

  function openAdd() {
    setEditId(null)
    resetForm()
    setView('form')
  }

  function openEdit(sale) {
    setEditId(sale.id)
    setForm({
      date: sale.date,
      reference: sale.reference || '',
      sellingPrice: sale.sellingPrice != null ? String(sale.sellingPrice) : '',
      items:
        sale.items && sale.items.length > 0
          ? sale.items.map(i => ({ _id: generateId(), productId: i.productId, variationId: i.variationId || '', quantity: i.quantity }))
          : [newItem()],
      fees: {
        commission: sale.fees?.commission != null ? String(sale.fees.commission) : '',
        transaction: sale.fees?.transaction != null ? String(sale.fees.transaction) : '',
        service: sale.fees?.service != null ? String(sale.fees.service) : '',
        saver: sale.fees?.saver != null ? String(sale.fees.saver) : '',
        voucher: sale.fees?.voucher != null ? String(sale.fees.voucher) : '',
      },
      saverEnabled: !!(sale.fees?.saver),
      accountId: sale.accountId || defaultAccountId,
    })
    setView('form')
  }

  function handleCancel() {
    setView('list')
    setEditId(null)
  }

  function handleDelete(sale) {
    dispatch({ type: 'DELETE_SALE', payload: sale.id })
  }

  function setFee(key, val) {
    setForm(f => ({ ...f, fees: { ...f.fees, [key]: val } }))
  }

  function addItem() {
    setForm(f => ({ ...f, items: [...f.items, newItem()] }))
  }

  function removeItem(id) {
    setForm(f => ({ ...f, items: f.items.filter(i => i._id !== id) }))
  }

  function updateItem(id, key, val) {
    setForm(f => ({
      ...f,
      items: f.items.map(i => (i._id === id ? { ...i, [key]: val } : i)),
    }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    const items = form.items
      .filter(i => i.productId && parseInt(i.quantity) > 0)
      .map(i => {
        const product = state.products.find(p => p.id === i.productId)
        return {
          productId: i.productId,
          ...(product?.hasVariations && i.variationId ? { variationId: i.variationId } : {}),
          quantity: parseInt(i.quantity),
        }
      })

    const fees = {}
    if (form.fees.commission) fees.commission = parseFloat(form.fees.commission)
    if (form.fees.transaction) fees.transaction = parseFloat(form.fees.transaction)
    if (form.fees.service) fees.service = parseFloat(form.fees.service)
    if (form.saverEnabled && form.fees.saver) fees.saver = parseFloat(form.fees.saver)
    if (form.fees.voucher) fees.voucher = parseFloat(form.fees.voucher)

    const payload = {
      date: form.date,
      reference: form.reference,
      sellingPrice: parseFloat(form.sellingPrice) || 0,
      items,
      fees,
      accountId: form.accountId || null,
    }

    if (editId) {
      dispatch({ type: 'UPDATE_SALE', payload: { id: editId, ...payload } })
    } else {
      dispatch({ type: 'ADD_SALE', payload })
    }
    handleCancel()
  }

  const preview = useMemo(() => {
    const sellingPrice = parseFloat(form.sellingPrice) || 0
    const commission = parseFloat(form.fees.commission) || 0
    const transaction = parseFloat(form.fees.transaction) || 0
    const service = parseFloat(form.fees.service) || 0
    const saver = form.saverEnabled ? parseFloat(form.fees.saver) || 0 : 0
    const voucher = parseFloat(form.fees.voucher) || 0
    const totalFees = commission + transaction + service + saver + voucher
    const netRevenue = sellingPrice - totalFees

    let totalCost = 0
    form.items.forEach(item => {
      if (!item.productId) return
      const product = state.products.find(p => p.id === item.productId)
      if (!product) return
      let costPerUnit = 0
      if (product.hasVariations && item.variationId) {
        const variation = product.variations?.find(v => v.id === item.variationId)
        costPerUnit = variation ? calculateVariationCostPerUnit(variation, state.shipments) : 0
      } else {
        costPerUnit = calculateProductCostPerUnit(product, state.shipments)
      }
      totalCost += costPerUnit * (parseInt(item.quantity) || 0)
    })

    const profit = netRevenue - totalCost
    return { sellingPrice, totalFees, netRevenue, totalCost, profit }
  }, [form, state.products, state.shipments])

  const sortedSales = [...state.sales].sort((a, b) => new Date(b.date) - new Date(a.date))

  function handleExportCSV() {
    const rows = sortedSales.map(s => {
      const { totalFees, netRevenue, totalCost, profit } = calculateSaleTotals(
        s,
        state.products,
        state.shipments
      )
      return {
        Date: s.date,
        Reference: s.reference || '',
        Products: getProductsSummary(s, state.products),
        Qty: getTotalQuantity(s),
        'Selling Price (RM)': s.sellingPrice,
        'Fees (RM)': totalFees.toFixed(2),
        'Net Revenue (RM)': netRevenue.toFixed(2),
        'Cost (RM)': totalCost.toFixed(2),
        'Profit (RM)': profit.toFixed(2),
      }
    })
    exportCSV(`okanemo-sales-${new Date().toISOString().split('T')[0]}.csv`, rows)
  }

  return (
    <div>
      {/* List View */}
      <div className={`tab-list-view${view === 'form' ? ' hidden' : ''}`}>
        <div className="page-header">
          <div className="page-header-row">
            <h1>Sales</h1>
            <div style={{ display: 'flex', gap: 8 }}>
              {sortedSales.length > 0 && (
                <Button variant="secondary" onClick={handleExportCSV}>
                  <Download className="icon-btn" /> Export CSV
                </Button>
              )}
              <Button variant="primary" onClick={openAdd}>+ Record Sale</Button>
            </div>
          </div>
        </div>

        <DataTable
          columns={SALES_COLUMNS}
          data={sortedSales}
          renderRow={s => {
            const { totalFees, netRevenue, profit } = calculateSaleTotals(
              s,
              state.products,
              state.shipments
            )
            return (
              <tr key={s.id}>
                <td>{formatDate(s.date)}</td>
                <td>{s.reference || '—'}</td>
                <td>{getProductsSummary(s, state.products)}</td>
                <td>{getTotalQuantity(s)}</td>
                <td>{formatMYR(s.sellingPrice)}</td>
                <td className="negative">{formatMYR(totalFees)}</td>
                <td>{formatMYR(netRevenue)}</td>
                <td className={profit >= 0 ? 'positive' : 'negative'}>{formatMYR(profit)}</td>
                <td>
                  <Button variant="icon" onClick={() => openEdit(s)} title="Edit"><Pencil /></Button>
                  <Button variant="icon" delete onClick={() => setConfirmDelete(s)} title="Delete"><Trash2 /></Button>
                </td>
              </tr>
            )
          }}
          emptyState={<EmptyState icon={ShoppingCart} message="No sales recorded yet." />}
        />
      </div>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => handleDelete(confirmDelete)}
        title="Delete Sale"
        message="Delete this sale? Stock will be restored."
      />

      {/* Sale Form */}
      <div className={`tab-form-view form-large${view === 'form' ? ' active' : ''}`}>
        <div className="form-view-header">
          <Button variant="back" onClick={handleCancel}><ArrowLeft /></Button>
          <h1>{editId ? 'Edit Sale' : 'Record Sale'}</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <FormGroup label="Date" required>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                required
              />
            </FormGroup>
            <FormGroup label="Reference / Order No.">
              <input
                type="text"
                placeholder="e.g. ORD-12345"
                value={form.reference}
                onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
              />
            </FormGroup>
          </div>

          {/* Items */}
          <div className="calculator-section">
            <div className="calculator-header">
              <h3>Items Sold</h3>
              <Button variant="add-row" type="button" onClick={addItem}>+ Add Item</Button>
            </div>
            <div className="calculator-table">
              <div className="calc-row calc-header">
                <span>Product</span>
                <span>Qty</span>
                <span>Cost/Unit</span>
                <span>Total Cost</span>
                <span></span>
              </div>
              {form.items.map(item => {
                const product = item.productId
                  ? state.products.find(p => p.id === item.productId)
                  : null
                const needsVariation = product?.hasVariations
                const selectedVariation = needsVariation && item.variationId
                  ? product.variations?.find(v => v.id === item.variationId)
                  : null
                let costPerUnit = 0
                if (needsVariation && selectedVariation) {
                  costPerUnit = calculateVariationCostPerUnit(selectedVariation, state.shipments)
                } else if (product && !needsVariation) {
                  costPerUnit = calculateProductCostPerUnit(product, state.shipments)
                }
                const lineTotal = costPerUnit * (parseInt(item.quantity) || 0)
                return (
                  <div key={item._id} className="calc-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <select
                      value={item.productId}
                      onChange={e => updateItem(item._id, 'productId', e.target.value)}
                      required
                    >
                      <option value="">Select product…</option>
                      {state.products.map(p => {
                        const stock = calculateStock(p, state.sales)
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name} ({stock} in stock)
                          </option>
                        )
                      })}
                    </select>
                    {needsVariation && (
                      <select
                        value={item.variationId}
                        onChange={e => updateItem(item._id, 'variationId', e.target.value)}
                        required
                        style={{ minWidth: 140 }}
                      >
                        <option value="">Select variation…</option>
                        {product.variations?.map(v => {
                          const vStock = calculateVariationStock(v)
                          return (
                            <option key={v.id} value={v.id}>
                              {getVariationLabel(v)} ({vStock} in stock)
                            </option>
                          )
                        })}
                      </select>
                    )}
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={e => updateItem(item._id, 'quantity', e.target.value)}
                    />
                    <span className="row-total">{formatMYR(costPerUnit)}</span>
                    <span className="row-total">{formatMYR(lineTotal)}</span>
                    {form.items.length > 1 && (
                      <Button variant="remove" type="button" onClick={() => removeItem(item._id)} title="Remove item"><X /></Button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="calculator-total">
              <span>Total Cost of Goods: </span>
              <strong>{formatMYR(preview.totalCost)}</strong>
            </div>
          </div>

          {/* Selling Price & Deposit Account */}
          <div className="form-row">
            <FormGroup label="Selling Price (RM)" required>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={form.sellingPrice}
                onChange={e => setForm(f => ({ ...f, sellingPrice: e.target.value }))}
                required
              />
            </FormGroup>
            <FormGroup label="Deposit To Account">
              <select
                value={form.accountId}
                onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}
              >
                <option value="">— No account —</option>
                {state.accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </FormGroup>
          </div>

          {/* Platform Fees */}
          <div className="fees-section">
            <h3>Platform Fees</h3>
            <div className="form-row">
              <FormGroup label="Commission (RM)">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.fees.commission}
                  onChange={e => setFee('commission', e.target.value)}
                />
              </FormGroup>
              <FormGroup label="Transaction Fee (RM)">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.fees.transaction}
                  onChange={e => setFee('transaction', e.target.value)}
                />
              </FormGroup>
            </div>
            <div className="form-row">
              <FormGroup label="Service Fee (RM)">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.fees.service}
                  onChange={e => setFee('service', e.target.value)}
                />
              </FormGroup>
              <FormGroup label="Voucher Rebate (RM)">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.fees.voucher}
                  onChange={e => setFee('voucher', e.target.value)}
                />
              </FormGroup>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={form.saverEnabled}
                    onChange={e => setForm(f => ({ ...f, saverEnabled: e.target.checked }))}
                    style={{ width: 'auto', marginRight: 8 }}
                  />
                  Saver Programme Fee (RM)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.fees.saver}
                  onChange={e => setFee('saver', e.target.value)}
                  disabled={!form.saverEnabled}
                />
              </div>
            </div>
          </div>

          {/* Profit Preview */}
          <div
            style={{
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              padding: 16,
              marginBottom: 16,
            }}
          >
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
              Profit Preview
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Selling Price</span>
                <span>{formatMYR(preview.sellingPrice)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Total Fees</span>
                <span className="negative">− {formatMYR(preview.totalFees)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: 6 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Net Revenue</span>
                <span>{formatMYR(preview.netRevenue)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Cost of Goods</span>
                <span className="negative">− {formatMYR(preview.totalCost)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: 6, fontWeight: 700 }}>
                <span>Profit</span>
                <span className={preview.profit >= 0 ? 'positive' : 'negative'} style={{ fontSize: 18 }}>
                  {formatMYR(preview.profit)}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" type="submit">
              {editId ? 'Save Changes' : 'Record Sale'}
            </Button>
            <Button variant="secondary" type="button" onClick={handleCancel}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
