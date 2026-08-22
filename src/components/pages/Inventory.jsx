import { useState, useMemo, Fragment } from 'react'
import {
  ChevronUp,
  ChevronDown,
  Circle,
  ExternalLink,
  Pencil,
  Trash2,
  PackagePlus,
  Package,
  ChartColumn,
  ArrowLeft,
} from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import { generateId, generateSKU, makeVariationSKU } from '../../utils/helpers'
import {
  formatMYR,
  calculateStock,
  calculateFIFOCostPerUnit,
  calculateVariationStock,
  calculateVariationCostPerUnit,
  getVariationLabel,
} from '../../utils/helpers'
import EmptyState from '../shared/EmptyState'
import ConfirmModal from '../shared/ConfirmModal'
import RestockModal from '../shared/RestockModal'
import Button from '../shared/Button'
import FormGroup from '../shared/FormGroup'
import DataTable from '../shared/DataTable'

const today = () => new Date().toISOString().split('T')[0]
const LOW_STOCK = 5

/**
 * Stock state as a status light: a filled dot plus a word. `strokeWidth={0}`
 * turns Lucide's outlined circle into a solid one, which reads at 8px where an
 * outline would just look like a smudge.
 */
function StockBadge({ tone, label, fontSize = 12 }) {
  return (
    <span
      style={{
        marginLeft: 8,
        fontSize,
        // Small text, so 'out' takes the strong red — --danger-text lands at
        // 4.46:1 against the page background, just under the 4.5:1 floor.
        color: tone === 'out' ? 'var(--danger-strong)' : 'var(--warning-text)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <Circle size={8} fill="currentColor" strokeWidth={0} aria-hidden="true" />
      {label}
    </span>
  )
}

const INVENTORY_COLUMNS = [
  { label: 'Product' },
  { label: 'Stock' },
  { label: 'FIFO Cost/Unit' },
  { label: 'Batches' },
  { label: 'Actions' },
]

const MARGIN_COLUMNS = [
  { label: 'Product' },
  { label: 'Stock' },
  { label: 'Cost/Unit' },
  { label: 'Target Margin %' },
  { label: 'Suggested Sell Price' },
  { label: 'Stock Value' },
]

/**
 * For each product (or variation), derive avg net revenue per unit from
 * single-product sales only.
 */
function computeProductMarginData(products, sales, shipments) {
  const rows = []

  products.forEach(product => {
    if (product.hasVariations && product.variations && product.variations.length > 0) {
      product.variations.forEach(variation => {
        const stock = calculateVariationStock(variation)
        const cost = calculateVariationCostPerUnit(variation, shipments)
        const stockValue = stock * cost

        const variationSales = sales.filter(s =>
          s.items && s.items.some(i => i.productId === product.id && i.variationId === variation.id)
        )

        let totalRevenue = 0
        let totalUnits = 0
        let multiOrderCount = 0

        variationSales.forEach(s => {
          const fees = s.fees || {}
          const totalFees =
            (fees.commission || 0) + (fees.transaction || 0) + (fees.service || 0) +
            (fees.saver || 0) + (fees.voucher || 0) + (fees.shipping || 0)
          const netRevenue = (s.sellingPrice || 0) - totalFees

          const distinctKeys = new Set(s.items.map(i => `${i.productId}:${i.variationId || ''}`))
          if (distinctKeys.size === 1) {
            const qty = s.items.reduce((sum, i) => sum + i.quantity, 0)
            totalRevenue += netRevenue
            totalUnits += qty
          } else {
            multiOrderCount++
          }
        })

        const targetMarginPct = variation.targetMarginPct ?? null
        const suggestedSellPrice =
          targetMarginPct !== null && targetMarginPct < 100 && cost > 0
            ? cost / (1 - targetMarginPct / 100)
            : null

        rows.push({
          key: variation.id,
          product,
          variation,
          label: `${product.name} — ${getVariationLabel(variation)}`,
          stock, cost, stockValue, targetMarginPct, suggestedSellPrice,
          multiOrderCount, totalUnits,
        })
      })
    } else {
      const stock = calculateStock(product, sales)
      const cost = calculateFIFOCostPerUnit(product, shipments)
      const stockValue = stock * cost

      const productSales = sales.filter(s => {
        if (s.items && s.items.length > 0) return s.items.some(i => i.productId === product.id)
        return s.productId === product.id
      })

      let totalRevenue = 0
      let totalUnits = 0
      let multiOrderCount = 0

      productSales.forEach(s => {
        const fees = s.fees || {}
        const totalFees =
          (fees.commission || 0) + (fees.transaction || 0) + (fees.service || 0) +
          (fees.saver || 0) + (fees.voucher || 0) + (fees.shipping || 0)
        const netRevenue = (s.sellingPrice || 0) - totalFees

        if (s.items && s.items.length > 0) {
          const distinctProducts = new Set(s.items.map(i => i.productId))
          if (distinctProducts.size === 1) {
            const qty = s.items.reduce((sum, i) => sum + i.quantity, 0)
            totalRevenue += netRevenue
            totalUnits += qty
          } else {
            multiOrderCount++
          }
        } else if (s.productId === product.id) {
          totalRevenue += netRevenue
          totalUnits += s.quantity || 0
        }
      })

      const targetMarginPct = product.targetMarginPct ?? null
      const suggestedSellPrice =
        targetMarginPct !== null && targetMarginPct < 100 && cost > 0
          ? cost / (1 - targetMarginPct / 100)
          : null

      rows.push({
        key: product.id,
        product,
        variation: null,
        label: product.name,
        stock, cost, stockValue, targetMarginPct, suggestedSellPrice,
        multiOrderCount, totalUnits,
      })
    }
  })

  return rows
}

// ===== Split comma-separated values =====
function splitValues(str) {
  return str
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

// ===== Generate cartesian product of tier values =====
function generateCombinations(tier1Values, tier2Values) {
  if (tier2Values.length === 0) {
    return tier1Values.map(t1 => ({ tier1Value: t1, tier2Value: null }))
  }
  const combos = []
  tier1Values.forEach(t1 => {
    tier2Values.forEach(t2 => {
      combos.push({ tier1Value: t1, tier2Value: t2 })
    })
  })
  return combos
}

const emptyAddForm = {
  name: '',
  sku: '',
  skuTouched: false,
  link: '',
  hasVariations: false,
  // variation config
  tier1Name: 'Colour',
  tier1Values: '',
  tier2Name: 'Size',
  tier2Values: '',
  // local product (non-variation)
  purchasePriceMYR: '',
  quantity: '',
  localCost: '',
}

export default function Inventory() {
  const { state, dispatch } = useApp()
  const [view, setView] = useState('list')
  const [activeTab, setActiveTab] = useState('inventory')
  const [editId, setEditId] = useState(null)
  const [restockTarget, setRestockTarget] = useState(null) // { productId, variationId? }
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmDeleteVariation, setConfirmDeleteVariation] = useState(null) // { product, variation }
  const [expandedProducts, setExpandedProducts] = useState(new Set())

  const [addForm, setAddForm] = useState(emptyAddForm)

  // Edit form for non-variation products
  const [editForm, setEditForm] = useState({ name: '', sku: '', link: '' })

  // Edit form for variation products
  const [editVarForm, setEditVarForm] = useState({
    name: '', sku: '', link: '',
    tier1Name: '', tier2Name: '',
    newVariationTier1: '', newVariationTier2: '',
  })

  function openAdd() {
    setAddForm(emptyAddForm)
    setView('add')
  }

  function openEdit(product) {
    setEditId(product.id)
    if (product.hasVariations) {
      setEditVarForm({
        name: product.name,
        sku: product.sku || '',
        link: product.link || '',
        tier1Name: product.tier1?.name || 'Colour',
        tier2Name: product.tier2?.name || 'Size',
        newVariationTier1: '',
        newVariationTier2: '',
      })
      setView('edit-variation')
    } else {
      setEditForm({ name: product.name, sku: product.sku || '', link: product.link || '' })
      setView('edit')
    }
  }

  // ===== Computed variation preview for add form =====
  const variationPreview = useMemo(() => {
    if (!addForm.hasVariations) return []
    const t1 = splitValues(addForm.tier1Values)
    const t2 = splitValues(addForm.tier2Values)
    if (t1.length === 0) return []
    const baseSku = addForm.sku.trim() || generateSKU(addForm.name.trim(), state.products.map(p => p.sku))
    return generateCombinations(t1, t2).map(combo => ({
      ...combo,
      sku: makeVariationSKU(baseSku, combo.tier1Value, combo.tier2Value),
      id: generateId(),
    }))
  }, [addForm.hasVariations, addForm.tier1Values, addForm.tier2Values, addForm.name, addForm.sku, state.products])

  function handleAddSubmit(e) {
    e.preventDefault()
    const baseSku = addForm.sku.trim() || generateSKU(addForm.name.trim(), state.products.map(p => p.sku))

    if (addForm.hasVariations) {
      const t1Values = splitValues(addForm.tier1Values)
      const t2Values = splitValues(addForm.tier2Values)
      if (t1Values.length === 0) return

      const variations = generateCombinations(t1Values, t2Values).map(combo => ({
        id: generateId(),
        tier1Value: combo.tier1Value,
        tier2Value: combo.tier2Value,
        sku: makeVariationSKU(baseSku, combo.tier1Value, combo.tier2Value),
        batches: [],
      }))

      dispatch({
        type: 'ADD_PRODUCT',
        payload: {
          name: addForm.name.trim(),
          sku: baseSku,
          link: addForm.link,
          hasVariations: true,
          tier1: { name: addForm.tier1Name.trim() || 'Colour' },
          tier2: addForm.tier2Values.trim() ? { name: addForm.tier2Name.trim() || 'Size' } : null,
          variations,
        },
      })
    } else {
      const qty = parseInt(addForm.quantity) || 0
      const price = parseFloat(addForm.purchasePriceMYR) || 0
      const localCost = parseFloat(addForm.localCost) || 0
      dispatch({
        type: 'ADD_PRODUCT',
        payload: {
          name: addForm.name.trim(),
          sku: baseSku,
          link: addForm.link,
          isLocal: true,
          purchasePriceMYR: price,
          localCost,
          quantity: qty,
          // A product is a record in its own right, so opening stock is
          // optional: create the SKU now for something still on order, and let
          // a shipment or a restock put units against it later.
          batches: qty > 0
            ? [
                {
                  id: generateId(),
                  dateAdded: today(),
                  purchasePriceMYR: price,
                  localCost,
                  quantity: qty,
                  remainingUnits: qty,
                  isLocal: true,
                },
              ]
            : [],
        },
      })
    }
    setView('list')
  }

  function handleEditSubmit(e) {
    e.preventDefault()
    const product = state.products.find(p => p.id === editId)
    dispatch({
      type: 'UPDATE_PRODUCT',
      payload: { ...product, name: editForm.name.trim(), sku: editForm.sku.trim(), link: editForm.link },
    })
    setView('list')
  }

  function handleEditVariationSubmit(e) {
    e.preventDefault()
    const product = state.products.find(p => p.id === editId)
    dispatch({
      type: 'UPDATE_PRODUCT',
      payload: {
        ...product,
        name: editVarForm.name.trim(),
        sku: editVarForm.sku.trim(),
        link: editVarForm.link,
        tier1: { ...product.tier1, name: editVarForm.tier1Name.trim() || 'Colour' },
        tier2: product.tier2 ? { ...product.tier2, name: editVarForm.tier2Name.trim() || 'Size' } : null,
      },
    })
    setView('list')
  }

  function handleAddVariation(e) {
    e.preventDefault()
    const product = state.products.find(p => p.id === editId)
    const t1 = editVarForm.newVariationTier1.trim()
    if (!t1) return
    const t2 = product.tier2 ? editVarForm.newVariationTier2.trim() : null
    const sku = makeVariationSKU(product.sku, t1, t2)
    dispatch({
      type: 'ADD_VARIATION',
      payload: {
        productId: editId,
        variation: { id: generateId(), tier1Value: t1, tier2Value: t2 || null, sku, batches: [] },
      },
    })
    setEditVarForm(f => ({ ...f, newVariationTier1: '', newVariationTier2: '' }))
  }

  function handleDeleteVariation(product, variation) {
    // Guard: has stock or sales
    const stock = calculateVariationStock(variation)
    const hasSales = state.sales.some(s =>
      s.items && s.items.some(i => i.productId === product.id && i.variationId === variation.id)
    )
    if (stock > 0 || hasSales) {
      setConfirmDeleteVariation({ product, variation })
    } else {
      dispatch({ type: 'DELETE_VARIATION', payload: { productId: product.id, variationId: variation.id } })
    }
  }

  function handleDelete(product) {
    dispatch({ type: 'DELETE_PRODUCT', payload: product.id })
  }

  function handleTargetMargin(row, value) {
    const pct = parseFloat(value)
    const newPct = isNaN(pct) || value === '' ? null : pct
    if (row.variation) {
      const product = row.product
      const updatedVariations = product.variations.map(v =>
        v.id === row.variation.id ? { ...v, targetMarginPct: newPct } : v
      )
      dispatch({ type: 'UPDATE_PRODUCT', payload: { ...product, variations: updatedVariations } })
    } else {
      dispatch({
        type: 'UPDATE_PRODUCT',
        payload: { ...row.product, targetMarginPct: newPct },
      })
    }
  }

  function toggleExpand(productId) {
    setExpandedProducts(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  const sortedProducts = [...state.products].sort((a, b) => a.name.localeCompare(b.name))
  const marginData = computeProductMarginData(sortedProducts, state.sales, state.shipments)

  const totalStockValue = marginData.reduce((sum, d) => sum + d.stockValue, 0)
  const trackedMargins = marginData.filter(d => d.targetMarginPct !== null)
  const avgOverallMargin = trackedMargins.length > 0
    ? trackedMargins.reduce((sum, d) => sum + d.targetMarginPct, 0) / trackedMargins.length
    : null

  return (
    <div>
      {/* ===== LIST VIEW ===== */}
      <div className={`tab-list-view${view !== 'list' ? ' hidden' : ''}`}>
        <div className="page-header">
          <div className="page-header-row">
            <h1>Inventory</h1>
            <Button variant="primary" onClick={openAdd}>+ Add Product</Button>
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
            {['inventory', 'margin'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: activeTab === tab ? 'var(--accent-solid)' : 'var(--bg-secondary)',
                  color: activeTab === tab ? '#fff' : 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: activeTab === tab ? 600 : 400,
                  textTransform: 'capitalize',
                }}
              >
                {tab === 'inventory'
                  ? 'Products'
                  : avgOverallMargin !== null
                  ? `Margin (${avgOverallMargin.toFixed(1)}%)`
                  : 'Margin'}
              </button>
            ))}
          </div>
        </div>

        {/* ---- Products Tab ---- */}
        {activeTab === 'inventory' && (
          <DataTable
            columns={INVENTORY_COLUMNS}
            data={sortedProducts}
            renderRow={p => {
              if (p.hasVariations) {
                const totalStock = calculateStock(p, state.sales)
                const isExpanded = expandedProducts.has(p.id)
                const isOut = totalStock <= 0
                const isLow = !isOut && totalStock <= LOW_STOCK
                return (
                  <Fragment key={p.id}>
                    {/* Parent row */}
                    <tr style={{ background: 'var(--bg-secondary)' }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            onClick={() => toggleExpand(p.id)}
                            style={{
                              background: 'none', border: '1px solid var(--border-color)',
                              borderRadius: 4, cursor: 'pointer', padding: '1px 6px',
                              fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4,
                              display: 'inline-flex', alignItems: 'center',
                            }}
                            title={isExpanded ? 'Collapse variations' : 'Expand variations'}
                          >
                            {isExpanded
                              ? <ChevronUp size={14} />
                              : <ChevronDown size={14} />}
                          </button>
                          <div>
                            <strong>{p.name}</strong>
                            {isOut && <StockBadge tone="out" label="Out of stock" />}
                            {isLow && <StockBadge tone="low" label="Low stock" />}
                            <br />
                            <span style={{ fontSize: 11, color: 'var(--accent-text)', fontWeight: 600 }}>
                              {p.variations.length} variation{p.variations.length !== 1 ? 's' : ''}
                              {' · '}
                              {p.tier1?.name}{p.tier2 ? ` × ${p.tier2.name}` : ''}
                            </span>
                            {p.sku && (
                              <><br /><span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.sku}</span></>
                            )}
                            {p.link && (
                              <>
                                <br />
                                <a href={p.link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent-text)' }}>
                                  View link <ExternalLink className="icon-sm" />
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                      <td><strong>{totalStock}</strong></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        per variation <ChevronDown className="icon-sm" />
                      </td>
                      <td>—</td>
                      <td>
                        <Button variant="icon" onClick={() => openEdit(p)} title="Edit"><Pencil /></Button>
                        <Button variant="icon" delete onClick={() => setConfirmDelete(p)} title="Delete"><Trash2 /></Button>
                      </td>
                    </tr>

                    {/* Variation rows */}
                    {isExpanded && p.variations.map(v => {
                      const vStock = calculateVariationStock(v)
                      const vCost = calculateVariationCostPerUnit(v, state.shipments)
                      const vOut = vStock <= 0
                      const vLow = !vOut && vStock <= LOW_STOCK
                      return (
                        <tr key={v.id} style={{ background: 'var(--bg-primary)' }}>
                          <td style={{ paddingLeft: 48 }}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                              {getVariationLabel(v)}
                            </span>
                            {vOut && <StockBadge tone="out" label="Out" fontSize={11} />}
                            {vLow && <StockBadge tone="low" label="Low" fontSize={11} />}
                            {v.sku && (
                              <><br /><span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{v.sku}</span></>
                            )}
                          </td>
                          <td>{vStock}</td>
                          <td>{formatMYR(vCost)}</td>
                          <td>{v.batches?.length ?? 0}</td>
                          <td>
                            <Button
                              variant="icon"
                              onClick={() => setRestockTarget({ productId: p.id, variationId: v.id })}
                              title="Restock"
                            >
                              <PackagePlus />
                            </Button>
                            <Button
                              variant="icon"
                              delete
                              onClick={() => handleDeleteVariation(p, v)}
                              title="Delete variation"
                            >
                              <Trash2 />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              }

              // Non-variation product
              const stock = calculateStock(p, state.sales)
              const cost = calculateFIFOCostPerUnit(p, state.shipments)
              const isOut = stock <= 0
              const isLow = !isOut && stock <= LOW_STOCK
              return (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    {isOut && <StockBadge tone="out" label="Out of stock" />}
                    {isLow && <StockBadge tone="low" label="Low stock" />}
                    {p.sku && (
                      <><br /><span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.sku}</span></>
                    )}
                    {p.link && (
                      <>
                        <br />
                        <a href={p.link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent-text)' }}>
                          View link <ExternalLink className="icon-sm" />
                        </a>
                      </>
                    )}
                  </td>
                  <td>{stock}</td>
                  <td>{formatMYR(cost)}</td>
                  <td>{p.batches?.length ?? 0}</td>
                  <td>
                    <Button variant="icon" onClick={() => openEdit(p)} title="Edit"><Pencil /></Button>
                    <Button variant="icon" onClick={() => setRestockTarget({ productId: p.id })} title="Restock"><PackagePlus /></Button>
                    <Button variant="icon" delete onClick={() => setConfirmDelete(p)} title="Delete"><Trash2 /></Button>
                  </td>
                </tr>
              )
            }}
            emptyState={
              <EmptyState
                icon={Package}
                message="No products yet. Add one here — opening stock is optional, so you can create the SKU now and receive units when your shipment arrives."
              />
            }
          />
        )}

        {/* ---- Margin Tab ---- */}
        {activeTab === 'margin' && (
          <>
            <div style={{
              display: 'flex', gap: 24, padding: '12px 16px',
              background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
              marginBottom: 16, fontSize: 13, flexWrap: 'wrap',
            }}>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Total Stock Value: </span>
                <strong>{formatMYR(totalStockValue)}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Margin set: </span>
                <strong>{marginData.filter(d => d.targetMarginPct !== null).length} / {marginData.length} SKUs</strong>
              </div>
            </div>

            <DataTable
              columns={MARGIN_COLUMNS}
              data={marginData}
              renderRow={row => {
                const { stock, cost, stockValue, targetMarginPct, suggestedSellPrice, label } = row
                const marginColor = targetMarginPct === null
                  ? 'var(--text-muted)'
                  : targetMarginPct >= 30 ? '#16a34a'
                  : targetMarginPct >= 10 ? '#f59e0b'
                  : '#dc2626'
                return (
                  <tr key={row.key}>
                    <td>
                      <strong>{row.variation ? row.product.name : row.product.name}</strong>
                      {row.variation && (
                        <><br /><span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{getVariationLabel(row.variation)}</span></>
                      )}
                    </td>
                    <td>{stock}</td>
                    <td>{formatMYR(cost)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          max="99"
                          placeholder="e.g. 30"
                          value={targetMarginPct !== null ? targetMarginPct : ''}
                          onChange={e => handleTargetMargin(row, e.target.value)}
                          style={{
                            width: 70, padding: '3px 6px', fontSize: 13,
                            border: `1px solid ${targetMarginPct !== null ? marginColor : 'var(--border-color)'}`,
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--bg-primary)',
                            color: targetMarginPct !== null ? marginColor : 'var(--text-primary)',
                            fontWeight: targetMarginPct !== null ? 600 : 400,
                          }}
                        />
                        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>%</span>
                      </div>
                    </td>
                    <td>
                      {suggestedSellPrice !== null
                        ? <strong style={{ color: 'var(--accent-text)', fontSize: 15 }}>{formatMYR(suggestedSellPrice)}</strong>
                        : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>enter margin %</span>
                      }
                    </td>
                    <td>{formatMYR(stockValue)}</td>
                  </tr>
                )
              }}
              emptyState={<EmptyState icon={ChartColumn} message="No products to analyse." />}
            />
          </>
        )}
      </div>

      {/* ===== ADD PRODUCT FORM ===== */}
      <div className={`tab-form-view form-large${view === 'add' ? ' active' : ''}`}>
        <div className="form-view-header">
          <Button variant="back" onClick={() => setView('list')}><ArrowLeft /></Button>
          <h1>Add Product</h1>
        </div>
        <form onSubmit={handleAddSubmit}>
          <div className="form-row">
            <FormGroup label="Product Name" required>
              <input
                type="text"
                placeholder="e.g. Classic T-Shirt"
                value={addForm.name}
                onChange={e => {
                  const name = e.target.value
                  setAddForm(f => ({
                    ...f,
                    name,
                    sku: f.skuTouched ? f.sku : generateSKU(name, state.products.map(p => p.sku)),
                  }))
                }}
                required
              />
            </FormGroup>
            <FormGroup label="Base SKU" hint="Auto-generated — edit to override">
              <input
                type="text"
                placeholder="e.g. TSHIRT-001"
                value={addForm.sku}
                onChange={e => setAddForm(f => ({ ...f, sku: e.target.value, skuTouched: true }))}
              />
            </FormGroup>
          </div>
          <div className="form-row">
            <FormGroup label="Product Link">
              <input
                type="url"
                placeholder="https://…"
                value={addForm.link}
                onChange={e => setAddForm(f => ({ ...f, link: e.target.value }))}
              />
            </FormGroup>
          </div>

          {/* Variation toggle */}
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={addForm.hasVariations}
                onChange={e => setAddForm(f => ({ ...f, hasVariations: e.target.checked }))}
                style={{ width: 'auto' }}
              />
              <span style={{ fontWeight: 600 }}>This product has variations (e.g. Colour, Size)</span>
            </label>
          </div>

          {/* ---- Variation config ---- */}
          {addForm.hasVariations && (
            <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Variation Tiers</h3>

              <div className="form-row">
                <FormGroup label="Tier 1 Name" hint='e.g. "Colour"'>
                  <input
                    type="text"
                    value={addForm.tier1Name}
                    onChange={e => setAddForm(f => ({ ...f, tier1Name: e.target.value }))}
                    placeholder="Colour"
                  />
                </FormGroup>
                <FormGroup label="Tier 1 Values" hint="Comma-separated, e.g. Red, Blue, Green" required={addForm.hasVariations}>
                  <input
                    type="text"
                    value={addForm.tier1Values}
                    onChange={e => setAddForm(f => ({ ...f, tier1Values: e.target.value }))}
                    placeholder="Red, Blue, Green"
                    required={addForm.hasVariations}
                  />
                </FormGroup>
              </div>

              <div className="form-row">
                <FormGroup label="Tier 2 Name (optional)" hint='e.g. "Size" — leave values blank to skip'>
                  <input
                    type="text"
                    value={addForm.tier2Name}
                    onChange={e => setAddForm(f => ({ ...f, tier2Name: e.target.value }))}
                    placeholder="Size"
                  />
                </FormGroup>
                <FormGroup label="Tier 2 Values" hint="Comma-separated, e.g. S, M, L, XL">
                  <input
                    type="text"
                    value={addForm.tier2Values}
                    onChange={e => setAddForm(f => ({ ...f, tier2Values: e.target.value }))}
                    placeholder="S, M, L, XL"
                  />
                </FormGroup>
              </div>

              {/* Preview grid */}
              {variationPreview.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    {variationPreview.length} variation{variationPreview.length !== 1 ? 's' : ''} will be created:
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {variationPreview.map((v, i) => (
                      <div key={i} style={{
                        padding: '4px 10px',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 12,
                      }}>
                        <span style={{ fontWeight: 600 }}>
                          {[v.tier1Value, v.tier2Value].filter(Boolean).join(' / ')}
                        </span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontFamily: 'monospace', fontSize: 11 }}>
                          {v.sku}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- Opening stock (non-variation only) ---- */}
          {!addForm.hasVariations && (
            <>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Opening Stock</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Optional — leave blank to create the product at zero stock, then receive units
                through a shipment or the Restock button.
              </p>
              <div className="form-row">
                <FormGroup label="Purchase Price (RM/unit)">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={addForm.purchasePriceMYR}
                    onChange={e => setAddForm(f => ({ ...f, purchasePriceMYR: e.target.value }))}
                  />
                </FormGroup>
                <FormGroup label="Quantity">
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={addForm.quantity}
                    onChange={e => setAddForm(f => ({ ...f, quantity: e.target.value }))}
                  />
                </FormGroup>
              </div>
              <div className="form-row">
                <FormGroup label="Local Costs (RM total)" hint="Shipping, handling, etc. — split evenly across all units">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={addForm.localCost}
                    onChange={e => setAddForm(f => ({ ...f, localCost: e.target.value }))}
                  />
                </FormGroup>
              </div>
            </>
          )}

          {addForm.hasVariations && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Stock for each variation is added via Shipments or the Restock button. Variations start at 0 stock.
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button variant="primary" type="submit">Add Product</Button>
            <Button variant="secondary" type="button" onClick={() => setView('list')}>Cancel</Button>
          </div>
        </form>
      </div>

      {/* ===== EDIT PRODUCT FORM (non-variation) ===== */}
      <div className={`tab-form-view${view === 'edit' ? ' active' : ''}`}>
        <div className="form-view-header">
          <Button variant="back" onClick={() => setView('list')}><ArrowLeft /></Button>
          <h1>Edit Product</h1>
        </div>
        <form onSubmit={handleEditSubmit}>
          <div className="form-row">
            <FormGroup label="Product Name" required>
              <input
                type="text"
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </FormGroup>
            <FormGroup label="SKU">
              <input
                type="text"
                value={editForm.sku}
                onChange={e => setEditForm(f => ({ ...f, sku: e.target.value }))}
              />
            </FormGroup>
          </div>
          <div className="form-row">
            <FormGroup label="Product Link">
              <input
                type="url"
                placeholder="https://…"
                value={editForm.link}
                onChange={e => setEditForm(f => ({ ...f, link: e.target.value }))}
              />
            </FormGroup>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button variant="primary" type="submit">Save Changes</Button>
            <Button variant="secondary" type="button" onClick={() => setView('list')}>Cancel</Button>
          </div>
        </form>
      </div>

      {/* ===== EDIT VARIATION PRODUCT FORM ===== */}
      <div className={`tab-form-view form-large${view === 'edit-variation' ? ' active' : ''}`}>
        <div className="form-view-header">
          <Button variant="back" onClick={() => setView('list')}><ArrowLeft /></Button>
          <h1>Edit Product — Variations</h1>
        </div>
        {(() => {
          const product = editId ? state.products.find(p => p.id === editId) : null
          if (!product) return null
          return (
            <>
              {/* Basic info */}
              <form onSubmit={handleEditVariationSubmit}>
                <div className="form-row">
                  <FormGroup label="Product Name" required>
                    <input
                      type="text"
                      value={editVarForm.name}
                      onChange={e => setEditVarForm(f => ({ ...f, name: e.target.value }))}
                      required
                    />
                  </FormGroup>
                  <FormGroup label="Base SKU">
                    <input
                      type="text"
                      value={editVarForm.sku}
                      onChange={e => setEditVarForm(f => ({ ...f, sku: e.target.value }))}
                    />
                  </FormGroup>
                </div>
                <div className="form-row">
                  <FormGroup label="Product Link">
                    <input
                      type="url"
                      placeholder="https://…"
                      value={editVarForm.link}
                      onChange={e => setEditVarForm(f => ({ ...f, link: e.target.value }))}
                    />
                  </FormGroup>
                </div>
                <div className="form-row">
                  <FormGroup label="Tier 1 Name">
                    <input
                      type="text"
                      value={editVarForm.tier1Name}
                      onChange={e => setEditVarForm(f => ({ ...f, tier1Name: e.target.value }))}
                    />
                  </FormGroup>
                  {product.tier2 && (
                    <FormGroup label="Tier 2 Name">
                      <input
                        type="text"
                        value={editVarForm.tier2Name}
                        onChange={e => setEditVarForm(f => ({ ...f, tier2Name: e.target.value }))}
                      />
                    </FormGroup>
                  )}
                </div>
                <Button variant="primary" type="submit">Save Changes</Button>
              </form>

              {/* Existing variations */}
              <div style={{ marginTop: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                  Variations ({product.variations.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {product.variations.map(v => {
                    const vStock = calculateVariationStock(v)
                    const hasSales = state.sales.some(s =>
                      s.items && s.items.some(i => i.productId === product.id && i.variationId === v.id)
                    )
                    return (
                      <div key={v.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '8px 12px',
                        background: 'var(--bg-secondary)',
                        borderRadius: 'var(--radius-sm)',
                      }}>
                        <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{getVariationLabel(v)}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{v.sku}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{vStock} in stock</span>
                        <Button
                          variant="icon"
                          delete
                          onClick={() => handleDeleteVariation(product, v)}
                          title="Delete variation"
                          disabled={vStock > 0 || hasSales}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Add new variation */}
              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Add Variation</h3>
                <form onSubmit={handleAddVariation}>
                  <div className="form-row">
                    <FormGroup label={product.tier1?.name || 'Tier 1'} required>
                      <input
                        type="text"
                        placeholder={`e.g. ${product.tier1?.name === 'Colour' ? 'Yellow' : 'New value'}`}
                        value={editVarForm.newVariationTier1}
                        onChange={e => setEditVarForm(f => ({ ...f, newVariationTier1: e.target.value }))}
                        required
                      />
                    </FormGroup>
                    {product.tier2 && (
                      <FormGroup label={product.tier2?.name || 'Tier 2'}>
                        <input
                          type="text"
                          placeholder={`e.g. ${product.tier2?.name === 'Size' ? 'XL' : 'New value'}`}
                          value={editVarForm.newVariationTier2}
                          onChange={e => setEditVarForm(f => ({ ...f, newVariationTier2: e.target.value }))}
                        />
                      </FormGroup>
                    )}
                  </div>
                  <Button variant="secondary" type="submit">+ Add Variation</Button>
                </form>
              </div>

              <div style={{ marginTop: 16 }}>
                <Button variant="secondary" onClick={() => setView('list')}>
                  <ArrowLeft className="icon-btn" /> Back to list
                </Button>
              </div>
            </>
          )
        })()}
      </div>

      {/* ===== MODALS ===== */}
      <RestockModal
        productId={restockTarget?.productId || null}
        variationId={restockTarget?.variationId || null}
        onClose={() => setRestockTarget(null)}
      />
      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => handleDelete(confirmDelete)}
        title="Delete Product"
        message={`Delete "${confirmDelete?.name}"? All variations and linked sales will also be removed.`}
      />
      <ConfirmModal
        open={!!confirmDeleteVariation}
        onClose={() => setConfirmDeleteVariation(null)}
        onConfirm={() => {
          const { product, variation } = confirmDeleteVariation
          dispatch({ type: 'DELETE_VARIATION', payload: { productId: product.id, variationId: variation.id } })
          setConfirmDeleteVariation(null)
        }}
        title="Delete Variation"
        message={`"${confirmDeleteVariation ? getVariationLabel(confirmDeleteVariation.variation) : ''}" has existing stock or sales. Delete anyway? This cannot be undone.`}
      />
    </div>
  )
}
