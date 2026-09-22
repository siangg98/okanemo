import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { test } from 'node:test'

const empty = () => ({
  suppliers: [], reloads: [], orders: [], shipments: [], products: [],
  sales: [], expenses: [], accounts: [], transfers: [],
})

async function startServer(dataDir, backupDir) {
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', OKANEMO_DATA_DIR: dataDir, OKANEMO_BACKUP_DIR: backupDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const port = await new Promise((resolvePort, reject) => {
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      const match = output.match(/Okanemo listening on 127\.0\.0\.1:(\d+)/)
      if (match) resolvePort(Number(match[1]))
    })
    child.on('error', reject)
    child.on('exit', code => reject(new Error(`Server exited before listening: ${code}`)))
  })
  return { child, base: `http://127.0.0.1:${port}` }
}

async function request(base, path, body, headers = {}) {
  const result = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: result.status, body: await result.json() }
}

async function stopServer(child) {
  child.kill()
  await once(child, 'exit')
}

test('volume data persists, stale saves fail, and backups restore the full dataset', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'okanemo-server-test-'))
  const dataDir = join(directory, 'data')
  const backupDir = join(directory, 'backups')
  let running = await startServer(dataDir, backupDir)
  t.after(async () => {
    if (running.child.exitCode === null) await stopServer(running.child)
    const safeRoot = resolve(tmpdir()) + sep
    assert.ok(resolve(directory).startsWith(safeRoot))
    rmSync(directory, { recursive: true, force: true })
  })

  assert.equal((await request(running.base, '/api/dataset', undefined, {
    Origin: 'http://localhost:5173',
  })).status, 200)
  assert.equal((await request(running.base, '/api/dataset', undefined, {
    Origin: 'https://example.com',
  })).status, 403)
  assert.deepEqual((await request(running.base, '/api/dataset')).body, { revision: 0, dataset: null })
  const original = empty()
  original.suppliers.push({ id: 'supplier-1', name: 'First' })
  original.accounts.push({ id: 'account-1', name: 'Bank', currency: 'MYR' })
  assert.equal((await request(running.base, '/api/dataset', { revision: 0, dataset: original })).body.revision, 1)
  assert.deepEqual((await request(running.base, '/api/dataset')).body.dataset, original)
  assert.equal((await request(running.base, '/api/dataset', { revision: 0, dataset: empty() })).status, 409)
  assert.equal((await request(running.base, '/api/dataset', { revision: 1, dataset: { suppliers: [] } })).status, 400)

  const replacement = empty()
  replacement.sales.push({ id: 'sale-1', sellingPrice: 20 })
  const restored = await request(running.base, '/api/restore', { revision: 1, dataset: replacement, confirmation: 'RESTORE' })
  assert.equal(restored.body.revision, 2)
  let backups = (await request(running.base, '/api/backups')).body.backups
  assert.ok(backups.some(name => name.startsWith('daily-')))
  const beforeRestore = backups.find(name => name.startsWith('pre-restore-'))
  assert.ok(beforeRestore)
  assert.equal((await request(running.base, '/api/restore-backup', {
    revision: 2, name: beforeRestore, confirmation: 'RESTORE',
  })).body.revision, 3)
  assert.deepEqual((await request(running.base, '/api/dataset')).body.dataset, original)

  assert.equal((await request(running.base, '/api/clear', { revision: 3, confirmation: 'CLEAR' })).body.revision, 4)
  assert.deepEqual((await request(running.base, '/api/dataset')).body, { revision: 4, dataset: null })
  backups = (await request(running.base, '/api/backups')).body.backups
  assert.ok(backups.some(name => name.startsWith('pre-clear-')))
  assert.ok(readdirSync(backupDir).some(name => name.endsWith('.sqlite')))

  await stopServer(running.child)
  running = await startServer(dataDir, backupDir)
  assert.deepEqual((await request(running.base, '/api/dataset')).body, { revision: 4, dataset: null })
  assert.equal((await request(running.base, '/api/dataset', { revision: 4, dataset: original })).body.revision, 5)
  assert.deepEqual((await request(running.base, '/api/dataset')).body.dataset, original)
})

// A backup folder is typically a bind mount, and mounts vanish: the host share
// drops, the folder is moved, the disk fills. When that took the whole save
// down with it the app looked like it was losing edits to a phantom other tab.
test('a save survives an unwritable backup folder, but clear still refuses', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'okanemo-backup-test-'))
  const dataDir = join(directory, 'data')
  const backupDir = join(directory, 'backups')
  const running = await startServer(dataDir, backupDir)
  t.after(async () => {
    if (running.child.exitCode === null) await stopServer(running.child)
    const safeRoot = resolve(tmpdir()) + sep
    assert.ok(resolve(directory).startsWith(safeRoot))
    rmSync(directory, { recursive: true, force: true })
  })

  const original = empty()
  original.accounts.push({ id: 'account-1', name: 'Bank', currency: 'MYR' })
  assert.equal((await request(running.base, '/api/dataset', { revision: 0, dataset: original })).body.revision, 1)

  // Put a plain file where the backup directory was, so every write under it
  // fails the way a dropped mount does.
  rmSync(backupDir, { recursive: true, force: true })
  writeFileSync(backupDir, 'not a directory')

  const withSale = empty()
  withSale.accounts.push({ id: 'account-1', name: 'Bank', currency: 'MYR' })
  withSale.sales.push({ id: 'sale-1', reference: '260908GW4JRVKN', sellingPrice: 300 })
  const saved = await request(running.base, '/api/dataset', { revision: 1, dataset: withSale })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.revision, 2)
  assert.match(saved.body.warning, /backup/i)
  assert.deepEqual((await request(running.base, '/api/dataset')).body.dataset, withSale)

  // Destructive operations keep their blocking safety backup: the snapshot is
  // the only thing standing between the user and the data being replaced.
  assert.equal((await request(running.base, '/api/clear', { revision: 2, confirmation: 'CLEAR' })).status, 500)
  assert.deepEqual((await request(running.base, '/api/dataset')).body.dataset, withSale)
})
