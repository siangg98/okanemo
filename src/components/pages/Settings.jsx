import { useEffect, useRef, useState } from 'react'
import { Check, Sparkles, Download, Upload, Trash2 } from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import { collectSKUs, generateSKU } from '../../utils/helpers'
import ConfirmModal from '../shared/ConfirmModal'
import Button from '../shared/Button'

function exportBackup(state) {
  const data = {
    version: 3,
    exportedAt: new Date().toISOString(),
    suppliers: state.suppliers,
    shipments: state.shipments,
    products: state.products,
    sales: state.sales,
    expenses: state.expenses,
    accounts: state.accounts,
    reloads: state.reloads,
    orders: state.orders,
    transfers: state.transfers,
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `okanemo-backup-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export default function Settings() {
  const { state, dispatch, restoreDataset, restoreBackup, clearDataset, listBackups } = useApp()
  const fileRef = useRef(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [importError, setImportError] = useState('')
  const [skuGenerated, setSkuGenerated] = useState(null)
  const [backups, setBackups] = useState([])
  const [selectedBackup, setSelectedBackup] = useState('')

  useEffect(() => {
    listBackups().then(result => setBackups(result.backups)).catch(error => setImportError(error.message))
  }, [listBackups])

  function handleGenerateMissingSKUs() {
    const missing = state.products.filter(p => !p.sku)
    // Accumulate assigned SKUs so sequence numbers stay correct within the batch
    const assignedSkus = collectSKUs(state.products)
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

  async function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setImportError('')
    try {
      const data = JSON.parse(await file.text())
      if (window.prompt('This replaces the shared dataset. Type RESTORE to continue:') !== 'RESTORE') return
      await restoreDataset(data)
      const result = await listBackups()
      setBackups(result.backups)
    } catch (error) {
      setImportError(error.message)
    } finally {
      e.target.value = ''
    }
  }

  async function handleClearData() {
    if (window.prompt('Type CLEAR to delete the shared dataset:') !== 'CLEAR') return
    try {
      await clearDataset()
    } catch (error) {
      setImportError(error.message)
    }
  }

  async function handleRestoreStoredBackup() {
    if (!selectedBackup) return
    if (window.prompt(`Replace the shared dataset with ${selectedBackup}? Type RESTORE:`) !== 'RESTORE') return
    try {
      setImportError('')
      await restoreBackup(selectedBackup)
      const result = await listBackups()
      setBackups(result.backups)
    } catch (error) {
      setImportError(error.message)
    }
  }

  const counts = {
    suppliers: state.suppliers.length,
    reloads: state.reloads.length,
    orders: state.orders.length,
    transfers: state.transfers.length,
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
              <p>Download the shared dataset as a JSON file.</p>
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
                <p role="alert" style={{ color: 'var(--danger)', marginTop: 4 }}>{importError}</p>
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
          <div className="settings-item">
            <div className="settings-info">
              <h4>Stored Backups</h4>
              <p>Daily copies are kept for 30 days in the host backup folder. Copy that folder off-device.</p>
            </div>
            <select value={selectedBackup} onChange={event => setSelectedBackup(event.target.value)} aria-label="Stored backup">
              <option value="">Select a backup</option>
              {backups.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <Button variant="secondary" onClick={handleRestoreStoredBackup} disabled={!selectedBackup}>Restore</Button>
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
              <p>Delete the shared dataset. A backup is made in the host folder first.</p>
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
        message="This deletes the shared dataset for every browser. A pre-clear backup will be saved in the host folder."
      />
    </div>
  )
}
