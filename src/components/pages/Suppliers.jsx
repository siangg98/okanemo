import { useState } from 'react'
import { Pencil, Trash2, Factory, ArrowLeft, Languages } from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import EmptyState from '../shared/EmptyState'
import ConfirmModal from '../shared/ConfirmModal'
import Button from '../shared/Button'
import FormGroup from '../shared/FormGroup'
import DataTable from '../shared/DataTable'

const PLATFORMS = ['Taobao', '1688', 'AliExpress', 'Pinduoduo', 'Other']
const emptyForm = { name: '', originalName: '', platform: 'Taobao', notes: '' }

const SUPPLIERS_COLUMNS = [
  { label: 'Name' },
  { label: 'Platform' },
  { label: 'Notes' },
  { label: 'Actions' },
]

export default function Suppliers() {
  const { state, dispatch } = useApp()
  const [view, setView] = useState('list')
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [translating, setTranslating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  function openAdd() {
    setEditId(null)
    setForm(emptyForm)
    setView('form')
  }

  function openEdit(supplier) {
    setEditId(supplier.id)
    setForm({
      name: supplier.name,
      originalName: supplier.originalName || '',
      platform: supplier.platform,
      notes: supplier.notes || '',
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
    if (editId) {
      dispatch({ type: 'UPDATE_SUPPLIER', payload: { id: editId, ...form } })
    } else {
      dispatch({ type: 'ADD_SUPPLIER', payload: { ...form } })
    }
    handleCancel()
  }

  function handleDeleteClick(supplier) {
    const linkedShipments = state.shipments.filter(s =>
      s.supplierGroups?.some(g => g.supplierId === supplier.id)
    )
    const linkedOrders = state.orders.filter(o => o.supplierId === supplier.id)
    if (linkedShipments.length > 0 || linkedOrders.length > 0) {
      const parts = []
      if (linkedOrders.length > 0) parts.push(`${linkedOrders.length} order(s)`)
      if (linkedShipments.length > 0) parts.push(`${linkedShipments.length} shipment(s)`)
      alert(`Cannot delete: ${parts.join(' and ')} use this supplier.`)
      return
    }
    setConfirmDelete(supplier)
  }

  function handleDelete(supplier) {
    dispatch({ type: 'DELETE_SUPPLIER', payload: supplier.id })
  }

  async function handleTranslate() {
    const name = form.originalName.trim()
    if (!name) return
    setTranslating(true)
    try {
      const res = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(name)}&langpair=zh-CN|en`
      )
      const data = await res.json()
      if (data.responseStatus === 200) {
        const translated = data.responseData.translatedText.replace(/\b\w/g, c => c.toUpperCase())
        setForm(f => ({ ...f, name: translated }))
      }
    } catch {
      window.open(
        `https://translate.google.com/?sl=zh-CN&tl=en&text=${encodeURIComponent(name)}`,
        '_blank'
      )
    } finally {
      setTranslating(false)
    }
  }

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
  }

  return (
    <div>
      <div className={`tab-list-view${view === 'form' ? ' hidden' : ''}`}>
        <div className="page-header">
          <div className="page-header-row">
            <h1>Suppliers</h1>
            <Button variant="primary" onClick={openAdd}>+ Add Supplier</Button>
          </div>
        </div>

        <DataTable
          columns={SUPPLIERS_COLUMNS}
          data={state.suppliers}
          renderRow={s => (
            <tr key={s.id}>
              <td>
                <strong>{s.name}</strong>
                {s.originalName && (
                  <>
                    <br />
                    <small style={{ color: 'var(--text-muted)' }}>{s.originalName}</small>
                  </>
                )}
              </td>
              <td>{s.platform}</td>
              <td>{s.notes || '—'}</td>
              <td>
                <Button variant="icon" onClick={() => openEdit(s)} title="Edit"><Pencil /></Button>
                <Button variant="icon" delete onClick={() => handleDeleteClick(s)} title="Delete"><Trash2 /></Button>
              </td>
            </tr>
          )}
          emptyState={<EmptyState icon={Factory} message="No suppliers yet. Add your first supplier to get started." />}
        />
      </div>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => handleDelete(confirmDelete)}
        title="Delete Supplier"
        message={`Delete supplier "${confirmDelete?.name}"?`}
      />

      <div className={`tab-form-view${view === 'form' ? ' active' : ''}`}>
        <div className="form-view-header">
          <Button variant="back" onClick={handleCancel}><ArrowLeft /></Button>
          <h1>{editId ? 'Edit Supplier' : 'Add Supplier'}</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <FormGroup label="Original Name (Chinese)">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="e.g. 供应商名称"
                  value={form.originalName}
                  onChange={e => set('originalName', e.target.value)}
                />
                <Button
                  variant="secondary"
                  type="button"
                  onClick={handleTranslate}
                  disabled={translating || !form.originalName.trim()}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {translating ? 'Translating…' : <><Languages className="icon-btn" /> Translate</>}
                </Button>
              </div>
            </FormGroup>
            <FormGroup label="Display Name" required>
              <input
                type="text"
                placeholder="e.g. Premium Supplier Co."
                value={form.name}
                onChange={e => set('name', e.target.value)}
                required
              />
            </FormGroup>
          </div>
          <div className="form-row">
            <FormGroup label="Platform" required>
              <select value={form.platform} onChange={e => set('platform', e.target.value)} required>
                {PLATFORMS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
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
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button variant="primary" type="submit">
              {editId ? 'Save Changes' : 'Add Supplier'}
            </Button>
            <Button variant="secondary" type="button" onClick={handleCancel}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
