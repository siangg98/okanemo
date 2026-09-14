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
  ArrowLeft,
} from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import {
  collectSKUs,
  findSKUConflict,
  generateId,
  generateSKU,
  makeVariationSKU,
  splitTierValues,
  generateVariationCombinations,
} from '../../utils/helpers'
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

/**
 * A SKU already in use, named so the owner is findable. Small text on the page
 * ground, so it takes --danger-strong: --danger-text lands at 4.46:1, just
 * under the 4.5:1 floor that text has to clear.
 */
function SkuConflict({ owner }) {
  if (!owner) return null
  return <span style={{ color: 'var(--danger-strong)' }}>Already used by {owner}</span>
}

const INVENTORY_COLUMNS = [
  { label: 'Product' },
  { label: 'Stock' },
  { label: 'FIFO Cost/Unit' },
  { label: 'Batches' },
  { label: 'Actions' },
]

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
    // id → SKU, so a hand-typed variation SKU is saved by the same button as
    // the rest of the form rather than persisting on every keystroke.
    variationSkus: {},
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
        // Only an overridden SKU is pre-filled. A derived one is left blank so
        // its placeholder tracks the base as you edit it — pre-filling the
        // current value instead would make every variation look hand-set the
        // moment the base changed, and freeze them all against the cascade.
        variationSkus: Object.fromEntries(
          (product.variations || []).map(v => [v.id, v.skuCustom ? v.sku || '' : ''])
        ),
      })
      setView('edit-variation')
    } else {
      setEditForm({ name: product.name, sku: product.sku || '', link: product.link || '' })
      setView('edit')
    }
  }

  // ===== SKU conflicts =====
  // The generator guarantees uniqueness for the SKUs it makes, but these fields
  // are typed by hand and used to be accepted in silence — which is how two
  // products came to share SKTCA07P-CASE. `editId` excludes the product being
  // edited: its own SKU is not a conflict with itself.
  const addSkuConflict = useMemo(
    () => (addForm.skuTouched ? findSKUConflict(addForm.sku, state.products) : null),
    [addForm.sku, addForm.skuTouched, state.products]
  )
  const editSkuConflict = useMemo(
    () => findSKUConflict(editForm.sku, state.products, editId),
    [editForm.sku, state.products, editId]
  )

  // The base and every variation SKU at once, checked against the rest of the
  // catalogue and against each other — two variations of the same product can
  // collide just as easily as two products can. Returns id → owner, with the
  // base under the 'base' key.
  const editVarConflicts = useMemo(() => {
    const product = state.products.find(p => p.id === editId)
    if (!product) return {}
    const base = editVarForm.sku.trim()
    const conflicts = {}
    const baseOwner = findSKUConflict(base, state.products, editId)
    if (baseOwner) conflicts.base = baseOwner
    const seen = new Map([[base.toUpperCase(), 'the base SKU']])
    ;(product.variations || []).forEach(v => {
      const typed = (editVarForm.variationSkus[v.id] ?? '').trim()
      const sku = typed || makeVariationSKU(base, v.tier1Value, v.tier2Value)
      const key = sku.toUpperCase()
      const owner = seen.get(key) || findSKUConflict(sku, state.products, editId)
      if (owner) conflicts[v.id] = owner
      if (!seen.has(key)) seen.set(key, getVariationLabel(v))
    })
    return conflicts
  }, [editId, editVarForm.sku, editVarForm.variationSkus, state.products])

  // ===== Computed variation preview for add form =====
  const variationPreview = useMemo(() => {
    if (!addForm.hasVariations) return []
    const t1 = splitTierValues(addForm.tier1Values)
    const t2 = splitTierValues(addForm.tier2Values)
    if (t1.length === 0) return []
    const baseSku = addForm.sku.trim() || generateSKU(addForm.name.trim(), collectSKUs(state.products))
    return generateVariationCombinations(t1, t2).map(combo => ({
      ...combo,
      sku: makeVariationSKU(baseSku, combo.tier1Value, combo.tier2Value),
      id: generateId(),
    }))
  }, [addForm.hasVariations, addForm.tier1Values, addForm.tier2Values, addForm.name, addForm.sku, state.products])

  function handleAddSubmit(e) {
    e.preventDefault()
    if (addSkuConflict) return
    const baseSku = addForm.sku.trim() || generateSKU(addForm.name.trim(), collectSKUs(state.products))

    if (addForm.hasVariations) {
      const t1Values = splitTierValues(addForm.tier1Values)
      const t2Values = splitTierValues(addForm.tier2Values)
      if (t1Values.length === 0) return

      const variations = generateVariationCombinations(t1Values, t2Values).map(combo => ({
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
    if (editSkuConflict) return
    const product = state.products.find(p => p.id === editId)
    dispatch({
      type: 'UPDATE_PRODUCT',
      payload: { ...product, name: editForm.name.trim(), sku: editForm.sku.trim(), link: editForm.link },
    })
    setView('list')
  }

  function handleEditVariationSubmit(e) {
    e.preventDefault()
    if (Object.keys(editVarConflicts).length > 0) return
    const product = state.products.find(p => p.id === editId)
    const sku = editVarForm.sku.trim()

    // Variation SKUs are derived from the base, so an edit to the base has to
    // carry down — leaving them behind is what stranded -CASE-001-WHITE under a
    // parent that had already dropped its -001. A SKU typed to something other
    // than what the base would produce is the owner's own and is flagged
    // `skuCustom` so nothing regenerates over it; typing the derived value back
    // in clears the flag rather than freezing it.
    const variations = (product.variations || []).map(v => {
      const derived = makeVariationSKU(sku, v.tier1Value, v.tier2Value)
      const typed = (editVarForm.variationSkus[v.id] ?? '').trim()
      return typed && typed !== derived
        ? { ...v, sku: typed, skuCustom: true }
        : { ...v, sku: derived, skuCustom: false }
    })

    dispatch({
      type: 'UPDATE_PRODUCT',
      payload: {
        ...product,
        name: editVarForm.name.trim(),
        sku,
        link: editVarForm.link,
        tier1: { ...product.tier1, name: editVarForm.tier1Name.trim() || 'Colour' },
        tier2: product.tier2 ? { ...product.tier2, name: editVarForm.tier2Name.trim() || 'Size' } : null,
        variations,
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

  function toggleExpand(productId) {
    setExpandedProducts(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  const sortedProducts = [...state.products].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div>
      {/* ===== LIST VIEW ===== */}
      <div className={`tab-list-view${view !== 'list' ? ' hidden' : ''}`}>
        <div className="page-header">
          <div className="page-header-row">
            <h1>Inventory</h1>
            <Button variant="primary" onClick={openAdd}>+ Add Product</Button>
          </div>
        </div>

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
                    sku: f.skuTouched ? f.sku : generateSKU(name, collectSKUs(state.products)),
                  }))
                }}
                required
              />
            </FormGroup>
            <FormGroup
              label="Base SKU"
              hint={
                addSkuConflict
                  ? <SkuConflict owner={addSkuConflict} />
                  : 'Auto-generated — edit to override'
              }
            >
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
            <Button variant="primary" type="submit" disabled={!!addSkuConflict}>Add Product</Button>
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
            <FormGroup label="SKU" hint={<SkuConflict owner={editSkuConflict} />}>
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
            <Button variant="primary" type="submit" disabled={!!editSkuConflict}>Save Changes</Button>
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
                  <FormGroup
                    label="Base SKU"
                    hint={
                      editVarConflicts.base
                        ? <SkuConflict owner={editVarConflicts.base} />
                        : 'Variation SKUs follow this unless overridden below'
                    }
                  >
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
                {/* Existing variations. Inside the form, so one Save Changes
                    covers the base SKU and the variation SKUs together — they
                    are derived from each other and can't be saved apart. */}
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
                      // Blank means "follow the base": the placeholder shows
                      // what that produces, so clearing the field is how you
                      // give an overridden SKU back to the generator.
                      const derived = makeVariationSKU(
                        editVarForm.sku.trim(), v.tier1Value, v.tier2Value
                      )
                      return (
                        <div key={v.id} style={{
                          display: 'flex', flexDirection: 'column', gap: 4,
                          padding: '8px 12px',
                          background: 'var(--bg-secondary)',
                          borderRadius: 'var(--radius-sm)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>
                              {getVariationLabel(v)}
                            </span>
                            <input
                              type="text"
                              className="variation-sku-input"
                              aria-label={`SKU for ${getVariationLabel(v)}`}
                              value={editVarForm.variationSkus[v.id] ?? ''}
                              placeholder={derived}
                              onChange={e => setEditVarForm(f => ({
                                ...f,
                                variationSkus: { ...f.variationSkus, [v.id]: e.target.value },
                              }))}
                            />
                            <span style={{
                              fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
                            }}>
                              {vStock} in stock
                            </span>
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
                          {editVarConflicts[v.id] && (
                            <small><SkuConflict owner={editVarConflicts[v.id]} /></small>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                <Button
                  variant="primary"
                  type="submit"
                  style={{ marginTop: 20 }}
                  disabled={Object.keys(editVarConflicts).length > 0}
                >
                  Save Changes
                </Button>
              </form>

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
