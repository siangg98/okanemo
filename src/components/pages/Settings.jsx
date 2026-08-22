import { useRef, useState } from 'react'
import { Check, Sparkles, Download, Upload, Trash2 } from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import { STORAGE_KEYS } from '../../utils/constants'
import { generateSKU } from '../../utils/helpers'
import ConfirmModal from '../shared/ConfirmModal'
import Button from '../shared/Button'

const ALL_KEYS = Object.values(STORAGE_KEYS)

function exportBackup(state) {
  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    suppliers: state.suppliers,
    shipments: state.shipments,
    products: state.products,
    sales: state.sales,
    expenses: state.expenses,
    accounts: state.accounts,
    reloads: state.reloads,
    orders: state.orders,
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `okanemo-backup-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function importBackup(json, dispatch) {
  let data
  try {
    data = JSON.parse(json)
  } catch {
    alert('Invalid JSON file.')
    return false
  }

  const expected = ['suppliers', 'shipments', 'products', 'sales', 'expenses', 'accounts']
  for (const key of expected) {
    if (!Array.isArray(data[key])) {
      alert(`Invalid backup: missing or malformed "${key}" field.`)
      return false
    }
  }

  // Slices added after v1 — absent from older backups, so default rather than reject
  const reloads = Array.isArray(data.reloads) ? data.reloads : []
  const orders = Array.isArray(data.orders) ? data.orders : []

  // Write directly to localStorage then reload
  localStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify(data.suppliers))
  localStorage.setItem(STORAGE_KEYS.SHIPMENTS, JSON.stringify(data.shipments))
  localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(data.products))
  localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(data.sales))
  localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(data.expenses))
  localStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(data.accounts))
  localStorage.setItem(STORAGE_KEYS.RELOADS, JSON.stringify(reloads))
  localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders))

  window.location.reload()
  return true
}

export default function Settings() {
  const { state, dispatch } = useApp()
  const fileRef = useRef(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [importError, setImportError] = useState('')
  const [skuGenerated, setSkuGenerated] = useState(null)

  function handleGenerateMissingSKUs() {
    const missing = state.products.filter(p => !p.sku)
    // Accumulate assigned SKUs so sequence numbers stay correct within the batch
    const assignedSkus = state.products.map(p => p.sku).filter(Boolean)
    missing.forEach(p => {
      const sku = generateSKU(p.name, assignedSkus)
      assignedSkus.push(sku)
      dispatch({ type: 'UPDATE_PRODUCT', payload: { ...p, sku } })
    })
    setSkuGenerated(missing.length)
  }

  function handleExport() {
    exportBackup(state)
  }

  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setImportError('')
    const reader = new FileReader()
    reader.onload = ev => {
      const ok = importBackup(ev.target.result, null)
      if (!ok) setImportError('Restore failed — see alert for details.')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleClearData() {
    ALL_KEYS.forEach(k => localStorage.removeItem(k))
    window.location.reload()
  }

  const counts = {
    suppliers: state.suppliers.length,
    reloads: state.reloads.length,
    orders: state.orders.length,
    shipments: state.shipments.length,
    products: state.products.length,
    sales: state.sales.length,
    expenses: state.expenses.length,
    accounts: state.accounts.length,
  }
  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {/* Data Overview */}
      <div className="settings-section">
        <div className="settings-title">Data Overview</div>
        <div className="settings-card">
          <div className="settings-item">
            <div className="settings-info">
              <h4>Stored Records</h4>
              <p>
                {counts.suppliers} suppliers · {counts.reloads} reloads · {counts.orders} orders ·{' '}
                {counts.shipments} shipments · {counts.products} products · {counts.sales} sales ·{' '}
                {counts.expenses} expenses · {counts.accounts} accounts
              </p>
            </div>
            <span style={{ fontWeight: 700, fontSize: 20, color: 'var(--accent-text)' }}>
              {totalRecords}
            </span>
          </div>
        </div>
      </div>

      {/* Inventory Tools */}
      <div className="settings-section">
        <div className="settings-title">Inventory Tools</div>
        <div className="settings-card">
          <div className="settings-item">
            <div className="settings-info">
              <h4>Generate Missing SKUs</h4>
              <p>
                {(() => {
                  const n = state.products.filter(p => !p.sku).length
                  return n === 0
                    ? 'All products already have a SKU.'
                    : `${n} product${n !== 1 ? 's' : ''} without a SKU.`
                })()}
                {skuGenerated !== null && skuGenerated > 0 && (
                  <span style={{ marginLeft: 8, color: 'var(--success, #16a34a)', fontWeight: 600 }}>
                    <Check className="icon-btn" /> {skuGenerated} SKU
                    {skuGenerated !== 1 ? 's' : ''} generated.
                  </span>
                )}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={handleGenerateMissingSKUs}
              disabled={state.products.filter(p => !p.sku).length === 0}
            >
              <Sparkles className="icon-btn" /> Generate SKUs
            </Button>
          </div>
        </div>
      </div>

      {/* Backup & Restore */}
      <div className="settings-section">
        <div className="settings-title">Backup & Restore</div>
        <div className="settings-card">
          <div className="settings-item">
            <div className="settings-info">
              <h4>Export Backup</h4>
              <p>Download all your data as a JSON file. Keep this safe — it contains everything.</p>
            </div>
            <Button variant="primary" onClick={handleExport}>
              <Download className="icon-btn" /> Export JSON
            </Button>
          </div>
          <div className="settings-item">
            <div className="settings-info">
              <h4>Restore from Backup</h4>
              <p>
                Upload a previously exported JSON file. <strong>This overwrites all current data.</strong>
              </p>
              {importError && (
                <p style={{ color: 'var(--danger)', marginTop: 4 }}>{importError}</p>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <Button variant="secondary" onClick={() => fileRef.current.click()}>
              <Upload className="icon-btn" /> Import JSON
            </Button>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="settings-section">
        <div className="settings-title">Danger Zone</div>
        <div className="settings-card">
          <div className="settings-item">
            <div className="settings-info">
              <h4>Clear All Data</h4>
              <p>Permanently delete all records from this device. Export a backup first.</p>
            </div>
            <Button
              variant="danger"
              onClick={() => setConfirmClear(true)}
              style={{
                background: 'var(--danger-solid)',
                color: '#fff',
                border: 'none',
                minWidth: 120,
                padding: '10px 20px',
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
              }}
            >
              <Trash2 className="icon-btn" /> Clear Data
            </Button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={handleClearData}
        title="Clear All Data"
        message="This will permanently delete all suppliers, reloads, shipments, products, sales, expenses, and accounts. Export a backup first. This cannot be undone."
      />
    </div>
  )
}
