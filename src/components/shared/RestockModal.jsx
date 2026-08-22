import { useState } from 'react'
import Modal from './Modal'
import { useApp } from '../../hooks/useApp'
import { getVariationLabel } from '../../utils/helpers'

const today = () => new Date().toISOString().split('T')[0]
const emptyForm = { purchasePriceMYR: '', quantity: '', localCost: '' }

export default function RestockModal({ productId, variationId, onClose }) {
  const { state, dispatch } = useApp()
  const [form, setForm] = useState(emptyForm)

  const product = productId ? state.products.find(p => p.id === productId) : null
  const variation = product?.hasVariations && variationId
    ? product.variations?.find(v => v.id === variationId)
    : null

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    const qty = parseInt(form.quantity)
    dispatch({
      type: 'RESTOCK_PRODUCT',
      payload: {
        productId,
        variationId: variationId || null,
        // Manual restocks sit outside the China consolidation flow — they carry
        // their own cost rather than a share of a shipment's freight.
        batch: {
          dateAdded: today(),
          purchasePriceMYR: parseFloat(form.purchasePriceMYR),
          packSize: 1,
          quantity: qty,
          remainingUnits: qty,
          isLocal: true,
          localCost: parseFloat(form.localCost) || 0,
        },
      },
    })
    setForm(emptyForm)
    onClose()
  }

  function handleClose() {
    setForm(emptyForm)
    onClose()
  }

  const title = variation
    ? `Restock — ${product?.name} (${getVariationLabel(variation)})`
    : `Restock — ${product?.name ?? ''}`

  return (
    <Modal
      open={!!productId}
      onClose={handleClose}
      title={title}
      size="small"
    >
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label>Purchase Price (RM/unit) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={form.purchasePriceMYR}
              onChange={e => set('purchasePriceMYR', e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Quantity *</label>
            <input
              type="number"
              min="1"
              placeholder="0"
              value={form.quantity}
              onChange={e => set('quantity', e.target.value)}
              required
            />
          </div>
        </div>
        <div className="form-group">
          <label>Other Costs (RM)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={form.localCost}
            onChange={e => set('localCost', e.target.value)}
          />
          <small>
            Delivery or handling for this batch, spread across its units. For China stock, use a
            consolidation on the Shipments page instead.
          </small>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Add Batch
          </button>
        </div>
      </form>
    </Modal>
  )
}
