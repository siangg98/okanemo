import { useState, useMemo, Fragment } from 'react'
import {
  ChevronUp,
  ChevronDown,
  Package,
  PackageCheck,
  Pencil,
  Trash2,
  Ship,
  Inbox,
  ArrowLeft,
} from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import {
  generateId,
  formatMYR,
  formatDate,
  formatForeign,
  getVariationLabel,
  calculateOrderItemUnitCostMYR,
  calculateShipmentValue,
  calculateShipmentLineValue,
  calculateLandedCostPerUnit,
  calculateAvailableQty,
  isLegacyShipment,
  resolveShipmentLine,
} from '../../utils/helpers'
import { SHIPMENT_STATUS } from '../../utils/constants'
import EmptyState from '../shared/EmptyState'
import ConfirmModal from '../shared/ConfirmModal'
import Modal from '../shared/Modal'
import Button from '../shared/Button'
import FormGroup from '../shared/FormGroup'
import DataTable from '../shared/DataTable'

const today = () => new Date().toISOString().split('T')[0]
const lineKey = (orderId, itemId) => `${orderId}::${itemId}`

const SHIPMENT_COLUMNS = [
  { label: 'Shipped' },
  { label: 'Description' },
  { label: 'Units' },
  { label: 'Goods Value' },
  { label: 'Freight' },
  { label: 'Landed Total' },
  { label: 'Status' },
  { label: 'Actions' },
]

const STATUS_STYLES = {
  draft: { background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' },
  shipped: { background: 'var(--info-bg)', color: 'var(--info-strong)' },
  arrived: { background: 'var(--accent-bg)', color: 'var(--accent-text)' },
}

/** A manifest-stamp chip, not a rounded pill — flat, uppercase, tracked out. */
function StatusPill({ status, legacy }) {
  return (
    <span
      style={{
        ...(STATUS_STYLES[status] || STATUS_STYLES.draft),
        padding: '3px 8px',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-display)',
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        whiteSpace: 'nowrap',
      }}
    >
      {SHIPMENT_STATUS[status] || status}
      {legacy && ' · legacy'}
    </span>
  )
}

function emptyForm() {
  return {
    dateShipped: today(),
    description: '',
    freightMYR: '',
    accountId: '',
    status: 'shipped',
    notes: '',
  }
}

export default function Shipments() {
  const { state, dispatch } = useApp()
  const [view, setView] = useState('list')
  const [editId, setEditId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [receiving, setReceiving] = useState(null)
  const [received, setReceived] = useState({})
  const [dateArrived, setDateArrived] = useState(today())
  const [form, setForm] = useState(emptyForm())
  // { [orderId::itemId]: qty as string }
  const [selected, setSelected] = useState({})
  const [expandedShipments, setExpandedShipments] = useState(new Set())

  function toggleExpand(shipmentId) {
    setExpandedShipments(prev => {
      const next = new Set(prev)
      if (next.has(shipmentId)) next.delete(shipmentId)
      else next.add(shipmentId)
      return next
    })
  }

  const payAccounts = state.accounts.filter(a => (a.currency || 'MYR') === 'MYR')

  /** Order lines still sitting in the warehouse, free to put in this box. */
  const availableLines = useMemo(() => {
    const rows = []
    state.orders
      .filter(o => o.status === 'at_warehouse')
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .forEach(order => {
        ;(order.items || []).forEach(item => {
          const available = calculateAvailableQty(order, item, state.shipments, editId)
          if (available > 0) rows.push({ order, item, available })
        })
      })
    return rows
  }, [state.orders, state.shipments, editId])

  function openAdd() {
    setEditId(null)
    const defaultAccount = payAccounts.find(a => a.isDefault) || payAccounts[0]
    setForm({ ...emptyForm(), accountId: defaultAccount?.id || '' })
    // Default to shipping everything at the warehouse — leaving stock behind is
    // the exception, so untick rather than tick.
    selectAll()
    setView('form')
  }

  function openEdit(shipment) {
    setEditId(shipment.id)
    setForm({
      dateShipped: shipment.dateShipped || shipment.date || today(),
      description: shipment.description || '',
      freightMYR: shipment.freightMYR != null ? String(shipment.freightMYR) : '',
      accountId: shipment.accountId || '',
      status: shipment.status || 'shipped',
      notes: shipment.notes || '',
    })
    const preset = {}
    ;(shipment.lines || []).forEach(l => {
      preset[lineKey(l.orderId, l.itemId)] = String(l.qty)
    })
    setSelected(preset)
    setView('form')
  }

  function handleCancel() {
    setView('list')
    setEditId(null)
  }

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  function toggleLine(row, checked) {
    const key = lineKey(row.order.id, row.item.id)
    setSelected(s => {
      const next = { ...s }
      if (checked) next[key] = String(row.available)
      else delete next[key]
      return next
    })
  }

  function setLineQty(row, value) {
    const key = lineKey(row.order.id, row.item.id)
    setSelected(s => ({ ...s, [key]: value }))
  }

  function selectAll() {
    const next = {}
    availableLines.forEach(row => {
      next[lineKey(row.order.id, row.item.id)] = String(row.available)
    })
    setSelected(next)
  }

  /** Shipment-shaped object for costing the current form state. */
  const draft = useMemo(() => {
    const lines = availableLines
      .filter(row => {
        const qty = parseFloat(selected[lineKey(row.order.id, row.item.id)])
        return qty > 0
      })
      .map(row => ({
        id: lineKey(row.order.id, row.item.id),
        orderId: row.order.id,
        itemId: row.item.id,
        qty: parseFloat(selected[lineKey(row.order.id, row.item.id)]) || 0,
      }))
    return { lines, freightMYR: parseFloat(form.freightMYR) || 0 }
  }, [availableLines, selected, form.freightMYR])

  const goodsValue = calculateShipmentValue(draft, state.orders)
  const draftUnits = draft.lines.reduce((s, l) => s + l.qty, 0)
  const landedTotal = goodsValue + (parseFloat(form.freightMYR) || 0)

  function handleSubmit(e) {
    e.preventDefault()
    const lines = draft.lines.map(l => ({
      id: editId ? l.id : generateId(),
      orderId: l.orderId,
      itemId: l.itemId,
      qty: l.qty,
      qtyReceived: null,
    }))

    const payload = {
      dateShipped: form.dateShipped,
      description: form.description,
      freightMYR: parseFloat(form.freightMYR) || 0,
      accountId: form.accountId || null,
      status: form.status,
      notes: form.notes,
      lines,
      dateArrived: null,
    }

    if (editId) {
      const existing = state.shipments.find(s => s.id === editId)
      dispatch({ type: 'UPDATE_SHIPMENT', payload: { ...existing, ...payload } })
    } else {
      dispatch({ type: 'ADD_SHIPMENT', payload })
    }
    handleCancel()
  }

  // ===== Receive / unpack =====
  function openReceive(shipment) {
    const preset = {}
    shipment.lines.forEach(l => {
      preset[l.id] = String(l.qty)
    })
    setReceived(preset)
    setDateArrived(today())
    setReceiving(shipment)
  }

  function confirmReceive() {
    dispatch({
      type: 'MARK_SHIPMENT_ARRIVED',
      payload: { id: receiving.id, dateArrived, received },
    })
    setReceiving(null)
  }

  /** Preview landed cost against the quantities being received. */
  const receivePreview = useMemo(() => {
    if (!receiving) return null
    const lines = receiving.lines.map(l => ({
      ...l,
      qtyReceived: parseFloat(received[l.id] ?? l.qty) || 0,
    }))
    return { ...receiving, lines }
  }, [receiving, received])

  function handleDeleteClick(shipment) {
    // Refuse if anything from this shipment has already been sold — removing
    // its batches would leave the sale costed against stock that never existed.
    const soldFrom = state.products.some(p => {
      const check = b => b.shipmentId === shipment.id && b.remainingUnits < b.quantity
      return (p.batches || []).some(check) || (p.variations || []).some(v => (v.batches || []).some(check))
    })
    if (soldFrom) {
      alert('Cannot delete: stock from this shipment has already been sold. Edit the sales first.')
      return
    }
    setConfirmDelete(shipment)
  }

  const sorted = useMemo(
    () =>
      [...state.shipments].sort(
        (a, b) => new Date(b.dateShipped || b.date) - new Date(a.dateShipped || a.date)
      ),
    [state.shipments]
  )

  const supplierName = id => state.suppliers.find(s => s.id === id)?.name || 'Unknown supplier'

  /** Product + variation a shipment line's order item points at, for display. */
  function resolveLineProduct(item) {
    const product = item.productId
      ? state.products.find(p => p.id === item.productId)
      : state.products.find(
          p => p.name.toLowerCase().trim() === (item.name || '').toLowerCase().trim()
        )
    const variation = item.variationId
      ? product?.variations?.find(v => v.id === item.variationId)
      : null
    return { product, variation }
  }

  return (
    <div>
      {/* List View */}
      <div className={`tab-list-view${view === 'form' ? ' hidden' : ''}`}>
        <div className="page-header">
          <div className="page-header-row">
            <h1>Shipments</h1>
            <Button variant="primary" onClick={openAdd}>+ New Consolidation</Button>
          </div>
        </div>

        {availableLines.length > 0 && view === 'list' && (
          <div
            style={{
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            <Package className="icon-btn" /> {availableLines.length} order line
            {availableLines.length === 1 ? '' : 's'} waiting at the China warehouse, ready to
            consolidate.
          </div>
        )}

        <DataTable
          columns={SHIPMENT_COLUMNS}
          data={sorted}
          renderRow={s => {
            const legacy = isLegacyShipment(s)
            const lines = s.lines || []
            const expandable = !legacy && lines.length > 0
            const isExpanded = expandable && expandedShipments.has(s.id)
            const units = legacy
              ? s.totalItems || 0
              : lines.reduce((n, l) => n + (l.qtyReceived ?? l.qty), 0)
            const goods = legacy
              ? (s.supplierGroups || []).reduce((n, g) => n + (g.totalValueMYR || 0), 0)
              : calculateShipmentValue(s, state.orders)
            const freight = s.freightMYR ?? s.shippingCost ?? 0
            return (
              <Fragment key={s.id}>
                <tr>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {expandable ? (
                        <button
                          onClick={() => toggleExpand(s.id)}
                          style={{
                            background: 'none', border: '1px solid var(--border-color)',
                            borderRadius: 4, cursor: 'pointer', padding: '1px 6px',
                            fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4,
                            display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                          }}
                          title={isExpanded ? 'Collapse items' : `Show ${lines.length} item${lines.length === 1 ? '' : 's'}`}
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      ) : (
                        <span style={{ width: 20, flexShrink: 0 }} />
                      )}
                      {formatDate(s.dateShipped || s.date)}
                    </div>
                  </td>
                  <td>{s.description || '—'}</td>
                  <td>{units}</td>
                  <td>{formatMYR(goods)}</td>
                  <td>{formatMYR(freight)}</td>
                  <td>{formatMYR(goods + freight)}</td>
                  <td><StatusPill status={s.status} legacy={legacy} /></td>
                  <td>
                    {!legacy && s.status !== 'arrived' && (
                      <Button variant="icon" title="Mark arrived & unpack" onClick={() => openReceive(s)}>
                        <PackageCheck />
                      </Button>
                    )}
                    {!legacy && s.status !== 'arrived' && (
                      <Button variant="icon" onClick={() => openEdit(s)} title="Edit"><Pencil /></Button>
                    )}
                    <Button variant="icon" delete onClick={() => handleDeleteClick(s)} title="Delete"><Trash2 /></Button>
                  </td>
                </tr>

                {isExpanded && lines.map(l => {
                  const { order, item } = resolveShipmentLine(l, state.orders)
                  if (!order || !item) {
                    return (
                      <tr key={l.id} style={{ background: 'var(--bg-primary)' }}>
                        <td colSpan={8} style={{ paddingLeft: 48, color: 'var(--text-muted)', fontSize: 12 }}>
                          Unknown item (source order line was removed)
                        </td>
                      </tr>
                    )
                  }
                  const { product, variation } = resolveLineProduct(item)
                  const received = l.qtyReceived ?? l.qty
                  const short = s.status === 'arrived' && received < l.qty
                  const lineValue = calculateShipmentLineValue(l, state.orders)
                  const landedPerUnit = calculateLandedCostPerUnit(l, s, state.orders)
                  const lineFreight = received > 0 ? landedPerUnit * received - lineValue : 0
                  return (
                    <tr key={l.id} style={{ background: 'var(--bg-primary)' }}>
                      <td style={{ paddingLeft: 48 }} colSpan={2}>
                        <span style={{ fontSize: 13 }}>{product?.name || item.name}</span>
                        {variation && (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                            {' '}({getVariationLabel(variation)})
                          </span>
                        )}
                        <br />
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {supplierName(order.supplierId)}
                        </span>
                      </td>
                      <td>
                        {received}
                        {short && (
                          <div style={{ fontSize: 11, color: 'var(--danger-strong)' }}>
                            {l.qty - received} short
                          </div>
                        )}
                      </td>
                      <td>{formatMYR(lineValue)}</td>
                      <td>{formatMYR(lineFreight)}</td>
                      <td>
                        {formatMYR(landedPerUnit * received)}
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {formatMYR(landedPerUnit)}/u
                        </div>
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  )
                })}
              </Fragment>
            )
          }}
          emptyState={
            <EmptyState
              icon={Ship}
              message="No shipments yet. Consolidate warehouse orders into a box to get started."
            />
          }
        />
      </div>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => dispatch({ type: 'DELETE_SHIPMENT', payload: confirmDelete.id })}
        title="Delete Shipment"
        message={
          confirmDelete?.status === 'arrived'
            ? `Delete "${confirmDelete?.description}"? The stock it created will be removed and its items go back to the warehouse.`
            : `Delete "${confirmDelete?.description}"? Its items go back to the warehouse, free to consolidate again.`
        }
      />

      {/* Receive / unpack */}
      <Modal
        open={!!receiving}
        onClose={() => setReceiving(null)}
        title={`Unpack — ${receiving?.description || 'Shipment'}`}
      >
        <div style={{ padding: 24 }}>
          <FormGroup label="Arrival Date" required>
            <input type="date" value={dateArrived} onChange={e => setDateArrived(e.target.value)} required />
          </FormGroup>

          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '12px 0' }}>
            Adjust anything that arrived short. Missing units keep their cost on the units that did
            turn up, so your margin stays honest.
          </p>

          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Expected</th>
                  <th>Received</th>
                  <th>Landed / unit</th>
                </tr>
              </thead>
              <tbody>
                {receiving?.lines.map(l => {
                  const order = state.orders.find(o => o.id === l.orderId)
                  const item = order?.items?.find(i => i.id === l.itemId)
                  const { product, variation } = item ? resolveLineProduct(item) : {}
                  const previewLine = receivePreview?.lines.find(x => x.id === l.id)
                  const landed = previewLine
                    ? calculateLandedCostPerUnit(previewLine, receivePreview, state.orders)
                    : 0
                  const short = (parseFloat(received[l.id]) || 0) < l.qty
                  return (
                    <tr key={l.id}>
                      <td>
                        {product?.name || item?.name || 'Unknown'}
                        {variation && (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                            {' '}({getVariationLabel(variation)})
                          </span>
                        )}
                      </td>
                      <td>{l.qty}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max={l.qty}
                          value={received[l.id] ?? ''}
                          onChange={e => setReceived(r => ({ ...r, [l.id]: e.target.value }))}
                          style={{ width: 80 }}
                        />
                      </td>
                      <td className={short ? 'negative' : ''}>{formatMYR(landed)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <Button variant="secondary" onClick={() => setReceiving(null)}>Cancel</Button>
            <Button variant="primary" onClick={confirmReceive}>Confirm Arrival & Add Stock</Button>
          </div>
        </div>
      </Modal>

      {/* Consolidation Form */}
      <div className={`tab-form-view form-large${view === 'form' ? ' active' : ''}`}>
        <div className="form-view-header">
          <Button variant="back" onClick={handleCancel}><ArrowLeft /></Button>
          <h1>{editId ? 'Edit Shipment' : 'New Consolidation'}</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <FormGroup label="Date Shipped" required>
              <input
                type="date"
                value={form.dateShipped}
                onChange={e => set('dateShipped', e.target.value)}
                required
              />
            </FormGroup>
            <FormGroup label="Description" required>
              <input
                type="text"
                placeholder="e.g. August Batch"
                value={form.description}
                onChange={e => set('description', e.target.value)}
                required
              />
            </FormGroup>
          </div>

          <div className="form-row">
            <FormGroup
              label="Freight Cost (RM)"
              hint="Prorated across every item by value — not split evenly"
            >
              <input
                type="number" step="0.01" min="0" placeholder="0.00"
                value={form.freightMYR}
                onChange={e => set('freightMYR', e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Freight Paid From" hint="Posted as an expense once it leaves draft">
              <select value={form.accountId} onChange={e => set('accountId', e.target.value)}>
                <option value="">— None —</option>
                {payAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </FormGroup>
          </div>

          <FormGroup label="Status" required>
            <select value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="draft">Draft — planning, freight not paid</option>
              <option value="shipped">In Transit — paid and on its way</option>
            </select>
          </FormGroup>

          {/* Line picker */}
          <div className="calculator-section" style={{ marginTop: 16 }}>
            <div className="calculator-header">
              <h3>What's in the box</h3>
              {availableLines.length > 0 && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="add-row" type="button" onClick={selectAll}>Select all</Button>
                  <Button variant="add-row" type="button" onClick={() => setSelected({})}>Clear</Button>
                </div>
              )}
            </div>

            {availableLines.length === 0 ? (
              <EmptyState
                icon={Inbox}
                message="Nothing at the warehouse. Mark an order 'At Warehouse' on the Orders page first."
              />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Item</th>
                    <th>From</th>
                    <th>Available</th>
                    <th>Ship Qty</th>
                    <th>Landed / unit</th>
                  </tr>
                </thead>
                <tbody>
                  {availableLines.map(row => {
                    const key = lineKey(row.order.id, row.item.id)
                    const raw = selected[key]
                    const checked = raw !== undefined
                    const qty = parseFloat(raw) || 0
                    const line = draft.lines.find(l => l.id === key)
                    const landed = line
                      ? calculateLandedCostPerUnit(line, draft, state.orders)
                      : calculateOrderItemUnitCostMYR(row.order, row.item)
                    const lineProduct = row.item.productId
                      ? state.products.find(p => p.id === row.item.productId)
                      : state.products.find(
                          p =>
                            p.name.toLowerCase().trim() ===
                            (row.item.name || '').toLowerCase().trim()
                        )
                    const variation = row.item.variationId
                      ? lineProduct?.variations?.find(v => v.id === row.item.variationId)
                      : null
                    return (
                      <tr key={key}>
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => toggleLine(row, e.target.checked)}
                          />
                        </td>
                        <td>
                          {lineProduct?.name || row.item.name}
                          {variation && (
                            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                              {' '}({getVariationLabel(variation)})
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {supplierName(row.order.supplierId)}
                          <span style={{ color: 'var(--text-muted)' }}>
                            {' · '}{formatForeign(row.item.unitPrice, row.order.currency)}/u
                          </span>
                        </td>
                        <td>{row.available}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            max={row.available}
                            value={raw ?? ''}
                            disabled={!checked}
                            onChange={e => setLineQty(row, e.target.value)}
                            style={{ width: 80 }}
                          />
                          {qty > row.available && (
                            <div style={{ fontSize: 11, color: 'var(--danger-text)' }}>
                              only {row.available} available
                            </div>
                          )}
                        </td>
                        <td>{checked && qty > 0 ? formatMYR(landed) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Summary */}
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
              <span style={{ color: 'var(--text-secondary)' }}>Units in box</span>
              <span>{draftUnits}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Goods value</span>
              <span>{formatMYR(goodsValue)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Freight</span>
              <span>+ {formatMYR(parseFloat(form.freightMYR) || 0)}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '1px solid var(--border-color)',
                paddingTop: 6,
                fontWeight: 600,
              }}
            >
              <span>Landed total</span>
              <strong style={{ color: 'var(--accent-text)' }}>{formatMYR(landedTotal)}</strong>
            </div>
            {goodsValue > 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                Freight adds {((parseFloat(form.freightMYR) || 0) / goodsValue * 100).toFixed(1)}% to
                every item's cost.
              </div>
            )}
          </div>

          <FormGroup label="Notes">
            <input
              type="text"
              placeholder="e.g. courier, tracking number"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          </FormGroup>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button variant="primary" type="submit" disabled={draft.lines.length === 0}>
              {editId ? 'Save Changes' : 'Create Shipment'}
            </Button>
            <Button variant="secondary" type="button" onClick={handleCancel}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
