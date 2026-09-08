import { useState, useMemo, Fragment } from 'react'
import {
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  Warehouse,
  Repeat,
  Pencil,
  Trash2,
  ClipboardList,
  ClipboardPaste,
  ArrowLeft,
  Check,
  X,
} from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import {
  generateId,
  generateSKU,
  makeVariationSKU,
  splitTierValues,
  generateVariationCombinations,
  formatMYR,
  formatDate,
  formatForeign,
  formatRate,
  getVariationLabel,
  calculateOrderItemsSubtotal,
  calculateOrderOverhead,
  calculateOrderTotal,
  calculateOrderDelta,
  calculateOrderItemUnitCost,
  calculateOrderItemUnitCostMYR,
  calculateShippedQty,
  isOrderFullyShipped,
  drawFromReloads,
  restoreToReloads,
} from '../../utils/helpers'
import { ORDER_STATUS } from '../../utils/constants'
import EmptyState from '../shared/EmptyState'
import ConfirmModal from '../shared/ConfirmModal'
import Button from '../shared/Button'
import FormGroup from '../shared/FormGroup'
import DataTable from '../shared/DataTable'

const today = () => new Date().toISOString().split('T')[0]

/** Sentinel option value that opens the inline quick-create on a line. */
const NEW_PRODUCT = '__new__'

/**
 * The variation setup a quick-create line carries while it is being filled in.
 * Mirrors Inventory's Add Product form, because a second tier is the one thing
 * that cannot be added to a product after the fact.
 */
const inlineFieldStyle = {
  fontSize: 13,
  padding: '4px 8px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
}

/** "Black, White, Red" — truncated, since a two-tier set runs long fast. */
function summariseVariations(variations) {
  const labels = variations.map(getVariationLabel)
  return labels.length > 6
    ? `${labels.slice(0, 6).join(', ')}, +${labels.length - 6} more`
    : labels.join(', ')
}

function emptyVariationDraft() {
  return {
    varEnabled: false,
    tier1Name: 'Colour',
    tier1Values: '',
    tier2Name: 'Size',
    tier2Values: '',
  }
}

function newItem() {
  return {
    _id: generateId(),
    productId: '',
    name: '',
    variationId: '',
    qty: '',
    unitPrice: '',
    creating: false,
    ...emptyVariationDraft(),
  }
}

const ORDER_COLUMNS = [
  { label: 'Date' },
  { label: 'Supplier' },
  { label: 'Items' },
  { label: 'Order Total' },
  { label: 'Rate' },
  { label: 'Cost (RM)' },
  { label: 'Status' },
  { label: 'Actions' },
]

const STATUS_STYLES = {
  ordered: { background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' },
  at_warehouse: { background: 'var(--accent-bg)', color: 'var(--accent-text)' },
  cancelled: { background: 'var(--danger-bg)', color: 'var(--danger-strong)' },
}

/** A manifest-stamp chip, not a rounded pill — flat, uppercase, tracked out. */
function StatusPill({ status }) {
  return (
    <span
      style={{
        ...(STATUS_STYLES[status] || STATUS_STYLES.ordered),
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
      {ORDER_STATUS[status] || status}
    </span>
  )
}

/**
 * Parse pasted checkout rows: "name<tab>qty<tab>price" per line.
 * Tabs come from spreadsheet copies, commas from hand-typed lists.
 *
 * Names are matched against existing products so a paste of familiar items
 * lands fully linked. A name that matches nothing arrives in create mode with
 * the text filled in rather than as a new product — bulk entry is a shortcut
 * for typing, not a licence to mint SKUs from whatever a supplier called them.
 */
function parsePastedItems(text, products = []) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.includes('\t') ? line.split('\t') : line.split(',')
      if (parts.length < 3) return null
      const name = parts[0].trim()
      const qty = parseFloat(parts[1])
      const unitPrice = parseFloat(String(parts[2]).replace(/[^\d.-]/g, ''))
      if (!name || !(qty > 0) || Number.isNaN(unitPrice)) return null
      const match = products.find(p => (p.name || '').toLowerCase().trim() === name.toLowerCase())
      return {
        _id: generateId(),
        productId: match ? match.id : '',
        name: match ? match.name : name,
        variationId: '',
        qty: String(qty),
        unitPrice: String(unitPrice),
        creating: !match,
        ...emptyVariationDraft(),
      }
    })
    .filter(Boolean)
}

export default function Orders() {
  const { state, dispatch } = useApp()
  const [view, setView] = useState('list')
  const [editId, setEditId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [pasteText, setPasteText] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [expandedOrders, setExpandedOrders] = useState(new Set())

  function toggleExpand(orderId) {
    setExpandedOrders(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  const walletAccounts = state.accounts.filter(a => (a.currency || 'MYR') !== 'MYR')

  function emptyFormWithWallet() {
    return { ...emptyForm(), walletAccountId: walletAccounts[0]?.id || '' }
  }

  function openAdd() {
    setEditId(null)
    setForm(emptyFormWithWallet())
    setShowPaste(false)
    setView('form')
  }

  function openEdit(order) {
    setEditId(order.id)
    setForm(toForm(order))
    setShowPaste(false)
    setView('form')
  }

  function openClone(order) {
    setEditId(null)
    setForm({ ...toForm(order), date: today(), status: 'ordered' })
    setShowPaste(false)
    setView('form')
  }

  function handleCancel() {
    setView('list')
    setEditId(null)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const items = form.items
      .filter(i => i.productId && parseFloat(i.qty) > 0)
      .map(i => {
        const product = state.products.find(p => p.id === i.productId)
        return {
          id: i._id,
          productId: i.productId,
          // Display fallback only — arrival resolves the id, so a later rename
          // still lands the stock on the right product.
          name: product?.name || i.name.trim(),
          variationId: i.variationId || null,
          qty: parseFloat(i.qty),
          unitPrice: parseFloat(i.unitPrice) || 0,
          qtyReceived: null,
        }
      })

    const payload = {
      date: form.date,
      supplierId: form.supplierId || null,
      walletAccountId: form.walletAccountId || null,
      currency: wallet?.currency || 'CNY',
      items,
      domesticShipping: parseFloat(form.domesticShipping) || 0,
      sellerDiscount: parseFloat(form.sellerDiscount) || 0,
      otherAdjust: parseFloat(form.otherAdjust) || 0,
      checkoutTotal: form.checkoutTotal === '' ? null : parseFloat(form.checkoutTotal) || 0,
      status: form.status,
      notes: form.notes,
    }

    if (editId) {
      dispatch({ type: 'UPDATE_ORDER', payload: { id: editId, ...payload } })
    } else {
      dispatch({ type: 'ADD_ORDER', payload })
    }
    handleCancel()
  }

  // ===== Item helpers =====
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  function addItem() {
    setForm(f => ({ ...f, items: [...f.items, newItem()] }))
  }

  function removeItem(id) {
    setForm(f => ({ ...f, items: f.items.filter(i => i._id !== id) }))
  }

  function updateItem(id, key, value) {
    setForm(f => ({
      ...f,
      items: f.items.map(i => (i._id === id ? { ...i, [key]: value } : i)),
    }))
  }

  function patchItem(id, patch) {
    setForm(f => ({
      ...f,
      items: f.items.map(i => (i._id === id ? { ...i, ...patch } : i)),
    }))
  }

  function selectProduct(id, value) {
    if (value === NEW_PRODUCT) {
      patchItem(id, {
        creating: true,
        productId: '',
        name: '',
        variationId: '',
        ...emptyVariationDraft(),
      })
      return
    }
    const product = state.products.find(p => p.id === value)
    patchItem(id, { productId: value, name: product?.name || '', variationId: '' })
  }

  /**
   * Enter inside a quick-create field must not submit the whole order — it
   * means "create this product", the same as the name field's Enter does.
   */
  function stopEnter(e, item) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    createProductForItem(item._id, item.name)
  }

  /** The SKU the product head would get, which its variation SKUs hang off. */
  function draftBaseSku(name) {
    return generateSKU(name.trim(), state.products.map(p => p.sku))
  }

  /**
   * The variations a quick-create line would produce, given what is typed into
   * its draft so far. Empty whenever the line is not making a variation
   * product — the SKUs are only settled here so the preview and the dispatch
   * cannot disagree.
   */
  function draftVariations(item) {
    if (!item?.varEnabled) return []
    const t1 = splitTierValues(item.tier1Values)
    if (t1.length === 0) return []
    const t2 = splitTierValues(item.tier2Values)
    const baseSku = draftBaseSku(item.name)
    return generateVariationCombinations(t1, t2).map(combo => ({
      id: generateId(),
      tier1Value: combo.tier1Value,
      tier2Value: combo.tier2Value,
      sku: makeVariationSKU(baseSku, combo.tier1Value, combo.tier2Value),
      batches: [],
    }))
  }

  /**
   * Create the product this line is for and bind the line to it. The id is
   * generated here rather than in the reducer so the line can point at the new
   * product immediately — dispatch gives nothing back to wait on.
   */
  function createProductForItem(id, rawName) {
    const name = rawName.trim()
    if (!name) return

    // Typing a name that already exists should reuse it, not make a twin. The
    // variation draft is dropped with it: the existing product's own
    // variations are what this line has to choose from.
    const existing = state.products.find(
      p => (p.name || '').toLowerCase().trim() === name.toLowerCase()
    )
    if (existing) {
      patchItem(id, {
        productId: existing.id,
        name: existing.name,
        creating: false,
        ...emptyVariationDraft(),
      })
      return
    }

    const item = form.items.find(i => i._id === id)
    const variations = draftVariations(item)
    // Asking for variations and naming none would quietly create a plain
    // product — and a second tier can never be added later, so refuse instead.
    if (item?.varEnabled && variations.length === 0) return

    const productId = generateId()
    dispatch({
      type: 'ADD_PRODUCT',
      payload: {
        id: productId,
        name,
        link: '',
        batches: [],
        ...(variations.length > 0
          ? {
              sku: draftBaseSku(name),
              hasVariations: true,
              tier1: { name: item.tier1Name.trim() || 'Colour' },
              tier2: splitTierValues(item.tier2Values).length > 0
                ? { name: item.tier2Name.trim() || 'Size' }
                : null,
              variations,
            }
          : {}),
      },
    })
    patchItem(id, { productId, name, creating: false, ...emptyVariationDraft() })
  }

  function applyPaste() {
    const parsed = parsePastedItems(pasteText, state.products)
    if (parsed.length === 0) return
    setForm(f => {
      // Drop the trailing blank row a fresh form starts with
      const existing = f.items.filter(i => i.productId || i.name.trim() || i.qty || i.unitPrice)
      return { ...f, items: [...existing, ...parsed] }
    })
    setPasteText('')
    setShowPaste(false)
  }

  /** Push the unexplained difference into otherAdjust so the order matches the screenshot. */
  function balanceToCheckout() {
    setForm(f => {
      const delta = calculateOrderDelta(toOrderShape(f))
      const next = (parseFloat(f.otherAdjust) || 0) + delta
      return { ...f, otherAdjust: next.toFixed(2) }
    })
  }

  const wallet = state.accounts.find(a => a.id === form.walletAccountId)
  const currency = wallet?.currency || 'CNY'

  const sortedProducts = useMemo(
    () => [...state.products].sort((a, b) => a.name.localeCompare(b.name)),
    [state.products]
  )

  const parsedPaste = useMemo(
    () => parsePastedItems(pasteText, state.products),
    [pasteText, state.products]
  )
  const unmatchedPaste = parsedPaste.filter(i => !i.productId).length

  // A row with something typed in it but no product behind it would be dropped
  // on save. Block the submit and say so rather than losing it quietly.
  const unresolvedItems = form.items.filter(
    i => !i.productId && (i.name.trim() || i.qty || i.unitPrice)
  )

  const draft = toOrderShape(form)
  const itemsSubtotal = calculateOrderItemsSubtotal(draft)
  const overhead = calculateOrderOverhead(draft)
  const orderTotal = calculateOrderTotal(draft)
  const delta = calculateOrderDelta(draft)

  // Preview the wallet draw. On edit, put this order's own draw back first or
  // it would be counted twice.
  const previewPool = useMemo(() => {
    if (!editId) return state.reloads
    const existing = state.orders.find(o => o.id === editId)
    return restoreToReloads(state.reloads, existing?.reloadDraws)
  }, [editId, state.reloads, state.orders])

  const preview = drawFromReloads(previewPool, form.walletAccountId, orderTotal)

  const filtered = useMemo(() => {
    const list =
      statusFilter === 'all' ? state.orders : state.orders.filter(o => o.status === statusFilter)
    return [...list].sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [state.orders, statusFilter])

  const supplierName = id => {
    const s = state.suppliers.find(x => x.id === id)
    return s ? s.name : '—'
  }

  return (
    <div>
      {/* List View */}
      <div className={`tab-list-view${view === 'form' ? ' hidden' : ''}`}>
        <div className="page-header">
          <div className="page-header-row">
            <h1>Orders</h1>
            <Button variant="primary" onClick={openAdd}>+ Add Order</Button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {['all', ...Object.keys(ORDER_STATUS)].map(key => (
            <Button
              key={key}
              variant={statusFilter === key ? 'primary' : 'secondary'}
              onClick={() => setStatusFilter(key)}
            >
              {key === 'all' ? 'All' : ORDER_STATUS[key]}
              {key !== 'all' && ` (${state.orders.filter(o => o.status === key).length})`}
            </Button>
          ))}
        </div>

        <DataTable
          columns={ORDER_COLUMNS}
          data={filtered}
          renderRow={o => {
            const total = calculateOrderTotal(o)
            const items = o.items || []
            const units = items.reduce((s, i) => s + (i.qty || 0), 0)
            const costMYR = total * (o.rateMYR || 0)
            const expandable = items.length > 0
            const isExpanded = expandable && expandedOrders.has(o.id)
            return (
              <Fragment key={o.id}>
                <tr>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {expandable ? (
                        <button
                          onClick={() => toggleExpand(o.id)}
                          style={{
                            background: 'none', border: '1px solid var(--border-color)',
                            borderRadius: 4, cursor: 'pointer', padding: '1px 6px',
                            fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4,
                            display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                          }}
                          title={isExpanded ? 'Collapse items' : `Show ${items.length} item${items.length === 1 ? '' : 's'}`}
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      ) : (
                        <span style={{ width: 20, flexShrink: 0 }} />
                      )}
                      {formatDate(o.date)}
                    </div>
                  </td>
                  <td>{supplierName(o.supplierId)}</td>
                  <td>{units}</td>
                  <td>{formatForeign(total, o.currency)}</td>
                  <td>{o.rateMYR ? formatRate(o.rateMYR, o.currency) : '—'}</td>
                  <td>
                    {formatMYR(costMYR)}
                    {o.shortfallForeign > 0 && (
                      <span
                        title={`Wallet was short by ${formatForeign(o.shortfallForeign, o.currency)} — estimated at the latest rate`}
                        style={{ marginLeft: 4, cursor: 'help' }}
                      >
                        <AlertTriangle className="icon-sm" style={{ color: 'var(--warning-text, #b45309)' }} />
                      </span>
                    )}
                  </td>
                  <td>
                    <StatusPill status={o.status} />
                    {o.status === 'at_warehouse' && isOrderFullyShipped(o, state.shipments) && (
                      <span
                        title="Every item is in a shipment"
                        style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-muted)' }}
                      >
                        · shipped
                      </span>
                    )}
                  </td>
                  <td>
                    {o.status === 'ordered' && (
                      <Button
                        variant="icon"
                        title="Mark arrived at China warehouse"
                        onClick={() =>
                          dispatch({
                            type: 'SET_ORDER_STATUS',
                            payload: { id: o.id, status: 'at_warehouse' },
                          })
                        }
                      >
                        <Warehouse />
                      </Button>
                    )}
                    <Button variant="icon" onClick={() => openClone(o)} title="Reorder — clone into a new order"><Repeat /></Button>
                    <Button variant="icon" onClick={() => openEdit(o)} title="Edit"><Pencil /></Button>
                    <Button variant="icon" delete onClick={() => setConfirmDelete(o)} title="Delete"><Trash2 /></Button>
                  </td>
                </tr>

                {isExpanded && items.map(item => {
                  const product = item.productId
                    ? state.products.find(p => p.id === item.productId)
                    : null
                  const variation = item.variationId
                    ? product?.variations?.find(v => v.id === item.variationId)
                    : null
                  const qty = parseFloat(item.qty) || 0
                  const lineTotal = qty * calculateOrderItemUnitCost(o, item)
                  const lineCostMYR = qty * calculateOrderItemUnitCostMYR(o, item)
                  const shippedQty = calculateShippedQty(o.id, item.id, state.shipments)
                  return (
                    <tr key={item.id} style={{ background: 'var(--bg-primary)' }}>
                      <td colSpan={2} style={{ paddingLeft: 48 }}>
                        <span style={{ fontSize: 13 }}>{product?.name || item.name}</span>
                        {variation && (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                            {' '}({getVariationLabel(variation)})
                          </span>
                        )}
                      </td>
                      <td>{qty}</td>
                      <td>{formatForeign(lineTotal, o.currency)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {formatForeign(item.unitPrice, o.currency)}/u
                      </td>
                      <td>{formatMYR(lineCostMYR)}</td>
                      <td colSpan={2} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {shippedQty > 0 ? `${shippedQty} / ${qty} shipped` : 'Not yet shipped'}
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            )
          }}
          emptyState={
            <EmptyState
              icon={ClipboardList}
              message={
                statusFilter === 'all'
                  ? 'No orders yet. Add one when you check out with a supplier.'
                  : `No ${ORDER_STATUS[statusFilter]?.toLowerCase()} orders.`
              }
            />
          }
        />
      </div>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => dispatch({ type: 'DELETE_ORDER', payload: confirmDelete.id })}
        title="Delete Order"
        message={`Delete this order from ${supplierName(confirmDelete?.supplierId)}? Its ${formatForeign(
          calculateOrderTotal(confirmDelete || {}),
          confirmDelete?.currency
        )} goes back into the wallet.`}
      />

      {/* Order Form */}
      <div className={`tab-form-view form-large${view === 'form' ? ' active' : ''}`}>
        <div className="form-view-header">
          <Button variant="back" onClick={handleCancel}><ArrowLeft /></Button>
          <h1>{editId ? 'Edit Order' : 'Add Order'}</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <FormGroup label="Order Date" required>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} required />
            </FormGroup>
            <FormGroup label="Supplier">
              <select value={form.supplierId} onChange={e => set('supplierId', e.target.value)}>
                <option value="">Select supplier…</option>
                {state.suppliers.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.originalName ? `${s.name} / ${s.originalName} (${s.platform})` : `${s.name} (${s.platform})`}
                  </option>
                ))}
              </select>
            </FormGroup>
          </div>

          <div className="form-row">
            <FormGroup
              label="Paid From Wallet"
              required
              hint={
                walletAccounts.length > 0
                  ? 'Yuan is drawn from this wallet, oldest reload first'
                  : 'No wallet account yet — create one under Accounts'
              }
            >
              <select
                value={form.walletAccountId}
                onChange={e => set('walletAccountId', e.target.value)}
                required
              >
                <option value="">— Select wallet —</option>
                {walletAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
                ))}
              </select>
            </FormGroup>
            <FormGroup label="Status" required>
              <select value={form.status} onChange={e => set('status', e.target.value)}>
                {Object.entries(ORDER_STATUS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </FormGroup>
          </div>

          {/* Items */}
          <div className="calculator-section">
            <div className="calculator-header">
              <h3>Items</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="add-row" type="button" onClick={() => setShowPaste(v => !v)}>
                  <ClipboardPaste className="icon-btn" /> Paste Rows
                </Button>
                <Button variant="add-row" type="button" onClick={addItem}>+ Add Item</Button>
              </div>
            </div>

            {showPaste && (
              <div style={{ marginBottom: 12 }}>
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder={'Paste one line per item:\nName\tQty\tPrice\n\nTabs or commas both work.'}
                  rows={5}
                  style={{
                    width: '100%',
                    fontFamily: 'monospace',
                    fontSize: 12,
                    padding: 8,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <Button variant="secondary" type="button" onClick={applyPaste}>
                    Add {parsedPaste.length || ''} Rows
                  </Button>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {pasteText.trim() && parsedPaste.length === 0
                      ? 'No rows recognised — need name, qty and price per line.'
                      : unmatchedPaste > 0
                      ? `Existing rows are kept. ${unmatchedPaste} name${unmatchedPaste === 1 ? '' : 's'} match no product — confirm each below.`
                      : 'Existing rows are kept.'}
                  </span>
                </div>
              </div>
            )}

            <div className="calculator-table">
              <div className="calc-row calc-header shipment-item-header">
                <span>Product Name</span>
                <span>Qty</span>
                <span>Unit Price ({currency})</span>
                <span>Line Total</span>
                <span></span>
              </div>
              {form.items.map(item => {
                const lineTotal = (parseFloat(item.qty) || 0) * (parseFloat(item.unitPrice) || 0)
                const product = item.productId
                  ? state.products.find(p => p.id === item.productId)
                  : null
                const matchedProduct =
                  product?.hasVariations && product.variations?.length > 0 ? product : null
                const draftPreview =
                  item.creating && item.varEnabled ? draftVariations(item) : []
                return (
                  <div key={item._id} style={{ marginBottom: 8 }}>
                    <div className="calc-row">
                      {item.creating ? (
                        <input
                          type="text"
                          autoFocus
                          placeholder="New product name"
                          value={item.name}
                          onChange={e => updateItem(item._id, 'name', e.target.value)}
                          onKeyDown={e => stopEnter(e, item)}
                        />
                      ) : (
                        <select
                          value={item.productId}
                          onChange={e => selectProduct(item._id, e.target.value)}
                        >
                          <option value="">— Select product —</option>
                          {sortedProducts.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                          <option value={NEW_PRODUCT}>+ New product…</option>
                        </select>
                      )}
                      <input
                        type="number"
                        min="1"
                        placeholder="Qty"
                        value={item.qty}
                        onChange={e => updateItem(item._id, 'qty', e.target.value)}
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Price"
                        value={item.unitPrice}
                        onChange={e => updateItem(item._id, 'unitPrice', e.target.value)}
                      />
                      <span className="row-value" style={{ fontSize: 13 }}>
                        {formatForeign(lineTotal, currency)}
                      </span>
                      {form.items.length > 1 && (
                        <Button variant="remove" type="button" onClick={() => removeItem(item._id)} title="Remove item"><X /></Button>
                      )}
                    </div>
                    {item.creating && (
                      <div style={{
                        paddingLeft: 8, marginTop: 4,
                        display: 'flex', flexDirection: 'column', gap: 6,
                      }}>
                        <div style={{
                          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                        }}>
                          <Button
                            variant="secondary"
                            type="button"
                            disabled={!item.name.trim() || (item.varEnabled && draftPreview.length === 0)}
                            onClick={() => createProductForItem(item._id, item.name)}
                          >
                            Create {item.name.trim() ? `“${item.name.trim()}”` : 'product'}
                          </Button>
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() =>
                              patchItem(item._id, {
                                creating: false,
                                name: '',
                                ...emptyVariationDraft(),
                              })
                            }
                          >
                            Cancel
                          </Button>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Added to Inventory at zero stock — this order fills it on arrival.
                          </span>
                        </div>
                        <label style={{
                          display: 'flex', gap: 6, alignItems: 'center', fontSize: 12,
                        }}>
                          <input
                            type="checkbox"
                            checked={item.varEnabled}
                            onChange={e => updateItem(item._id, 'varEnabled', e.target.checked)}
                          />
                          This product has variations
                        </label>
                        {item.varEnabled && (
                          <div style={{
                            display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 20,
                          }}>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <input
                                type="text"
                                placeholder="Tier 1 name"
                                value={item.tier1Name}
                                onChange={e => updateItem(item._id, 'tier1Name', e.target.value)}
                                onKeyDown={e => stopEnter(e, item)}
                                style={{ ...inlineFieldStyle, width: 110 }}
                              />
                              <input
                                type="text"
                                placeholder="Values, e.g. Black, White, Red"
                                value={item.tier1Values}
                                onChange={e => updateItem(item._id, 'tier1Values', e.target.value)}
                                onKeyDown={e => stopEnter(e, item)}
                                style={{ ...inlineFieldStyle, flex: 1, minWidth: 200 }}
                              />
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <input
                                type="text"
                                placeholder="Tier 2 name"
                                value={item.tier2Name}
                                onChange={e => updateItem(item._id, 'tier2Name', e.target.value)}
                                onKeyDown={e => stopEnter(e, item)}
                                style={{ ...inlineFieldStyle, width: 110 }}
                              />
                              <input
                                type="text"
                                placeholder="Values (optional), e.g. S, M, L"
                                value={item.tier2Values}
                                onChange={e => updateItem(item._id, 'tier2Values', e.target.value)}
                                onKeyDown={e => stopEnter(e, item)}
                                style={{ ...inlineFieldStyle, flex: 1, minWidth: 200 }}
                              />
                            </div>
                            <span style={{
                              fontSize: 12,
                              color: draftPreview.length > 0
                                ? 'var(--text-muted)'
                                : 'var(--danger-text)',
                            }}>
                              {draftPreview.length > 0
                                ? `→ ${draftPreview.length} variation${draftPreview.length === 1 ? '' : 's'}: ${summariseVariations(draftPreview)}`
                                : 'Enter at least one Tier 1 value.'}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {!item.creating && !item.productId && item.name.trim() && (
                      <div style={{
                        paddingLeft: 8, marginTop: 4,
                        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                      }}>
                        <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>
                          “{item.name.trim()}” matches no product — pick one above, or
                        </span>
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={() => createProductForItem(item._id, item.name)}
                        >
                          Create it
                        </Button>
                      </div>
                    )}
                    {matchedProduct && (
                      <div style={{ paddingLeft: 8, marginTop: 4 }}>
                        <select
                          value={item.variationId}
                          onChange={e => updateItem(item._id, 'variationId', e.target.value)}
                          required
                          style={{
                            fontSize: 13,
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                          }}
                        >
                          <option value="">Select variation…</option>
                          {matchedProduct.variations?.map(v => (
                            <option key={v.id} value={v.id}>{getVariationLabel(v)}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Checkout reconciliation */}
          <div className="currency-section myr-section">
            <div className="currency-section-header">
              <span className="currency-title">Checkout Page</span>
            </div>
            <div className="currency-section-body">
              <div className="form-row">
                <FormGroup label={`Domestic Shipping (${currency})`}>
                  <input
                    type="number" step="0.01" min="0" placeholder="0.00"
                    value={form.domesticShipping}
                    onChange={e => set('domesticShipping', e.target.value)}
                  />
                </FormGroup>
                <FormGroup label={`Seller Discount (${currency})`}>
                  <input
                    type="number" step="0.01" min="0" placeholder="0.00"
                    value={form.sellerDiscount}
                    onChange={e => set('sellerDiscount', e.target.value)}
                  />
                </FormGroup>
              </div>
              <div className="form-row">
                <FormGroup
                  label={`Checkout Total (${currency})`}
                  hint="The grand total from your screenshot"
                >
                  <input
                    type="number" step="0.01" min="0" placeholder="0.00"
                    value={form.checkoutTotal}
                    onChange={e => set('checkoutTotal', e.target.value)}
                  />
                </FormGroup>
                <FormGroup
                  label={`Fees / Vouchers (${currency})`}
                  hint="Anything else on the checkout page — use Balance to fill this"
                >
                  <input
                    type="number" step="0.01" placeholder="0.00"
                    value={form.otherAdjust}
                    onChange={e => set('otherAdjust', e.target.value)}
                  />
                </FormGroup>
              </div>
            </div>
          </div>

          {/* Running totals */}
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
              <span style={{ color: 'var(--text-secondary)' }}>Items Subtotal</span>
              <span>{formatForeign(itemsSubtotal, currency)}</span>
            </div>
            {overhead !== 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Shipping / discount / fees</span>
                <span>{overhead > 0 ? '+ ' : '− '}{formatForeign(Math.abs(overhead), currency)}</span>
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
              <span>Order Total</span>
              <span>{formatForeign(orderTotal, currency)}</span>
            </div>

            {form.checkoutTotal !== '' && Math.abs(delta) >= 0.005 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 6,
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(239,68,68,0.12)',
                }}
              >
                <span style={{ color: 'var(--danger-text)' }}>
                  Off by {formatForeign(Math.abs(delta), currency)} vs your checkout total
                </span>
                <Button variant="secondary" type="button" onClick={balanceToCheckout}>
                  Balance the difference
                </Button>
              </div>
            )}
            {form.checkoutTotal !== '' && Math.abs(delta) < 0.005 && orderTotal > 0 && (
              <div style={{ marginTop: 4, color: 'var(--accent-text)' }}>
                <Check className="icon-btn" /> Matches your checkout total
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '1px solid var(--border-color)',
                paddingTop: 6,
                marginTop: 4,
              }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>
                Draws from {preview.draws.length || 0} reload{preview.draws.length === 1 ? '' : 's'}
                {preview.rateMYR > 0 && ` @ ${formatRate(preview.rateMYR, currency)}`}
              </span>
              <strong style={{ color: 'var(--accent-text)' }}>
                {formatMYR(orderTotal * preview.rateMYR)}
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

          <FormGroup label="Notes">
            <input
              type="text"
              placeholder="e.g. order number, tracking"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          </FormGroup>

          {unresolvedItems.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--danger-text)', marginTop: 8 }}>
              {unresolvedItems.length} item{unresolvedItems.length === 1 ? '' : 's'} still need a
              product selected or created.
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button variant="primary" type="submit" disabled={unresolvedItems.length > 0}>
              {editId ? 'Save Changes' : 'Add Order'}
            </Button>
            <Button variant="secondary" type="button" onClick={handleCancel}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ===== Form <-> order shape =====

function emptyForm() {
  return {
    date: today(),
    supplierId: '',
    walletAccountId: '',
    items: [newItem()],
    domesticShipping: '',
    sellerDiscount: '',
    otherAdjust: '',
    checkoutTotal: '',
    status: 'ordered',
    notes: '',
  }
}

function toForm(order) {
  return {
    date: order.date,
    supplierId: order.supplierId || '',
    walletAccountId: order.walletAccountId || '',
    items:
      order.items?.length > 0
        ? order.items.map(i => ({
            _id: i.id || generateId(),
            productId: i.productId || '',
            name: i.name || '',
            variationId: i.variationId || '',
            qty: String(i.qty),
            unitPrice: String(i.unitPrice),
            creating: false,
          }))
        : [newItem()],
    domesticShipping: order.domesticShipping ? String(order.domesticShipping) : '',
    sellerDiscount: order.sellerDiscount ? String(order.sellerDiscount) : '',
    otherAdjust: order.otherAdjust ? String(order.otherAdjust) : '',
    checkoutTotal: order.checkoutTotal != null ? String(order.checkoutTotal) : '',
    status: order.status || 'ordered',
    notes: order.notes || '',
  }
}

/** Form values are strings; cost helpers expect an order-shaped object. */
function toOrderShape(form) {
  return {
    items: form.items.map(i => ({ qty: i.qty, unitPrice: i.unitPrice })),
    domesticShipping: form.domesticShipping,
    sellerDiscount: form.sellerDiscount,
    otherAdjust: form.otherAdjust,
    checkoutTotal: form.checkoutTotal,
  }
}
