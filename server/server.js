import { createServer } from 'node:http'
import { DatabaseSync, backup } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const publicDir = resolve(root, 'dist')
const dataDir = resolve(process.env.OKANEMO_DATA_DIR || join(root, 'data'))
const backupDir = resolve(process.env.OKANEMO_BACKUP_DIR || join(root, 'backups'))
const port = Number(process.env.PORT || 8080)
const host = process.env.HOST || '127.0.0.1'
const keys = [
  'suppliers', 'reloads', 'orders', 'shipments', 'products',
  'sales', 'expenses', 'accounts', 'transfers',
]
const legacyRequired = ['suppliers', 'shipments', 'products', 'sales', 'expenses', 'accounts']
const maxBodyBytes = 20 * 1024 * 1024

mkdirSync(dataDir, { recursive: true })
mkdirSync(backupDir, { recursive: true })
const db = new DatabaseSync(join(dataDir, 'okanemo.sqlite'))
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS dataset (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL,
    document TEXT
  ) STRICT;
  INSERT OR IGNORE INTO dataset (id, revision, document) VALUES (1, 0, NULL);
`)
const getRow = db.prepare('SELECT revision, document FROM dataset WHERE id = 1')
const updateRow = db.prepare('UPDATE dataset SET revision = ?, document = ? WHERE id = 1')

function current() {
  const row = getRow.get()
  return { revision: row.revision, dataset: row.document === null ? null : JSON.parse(row.document) }
}

function normalizeDataset(value, legacy = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('Dataset must be an object.')
    error.status = 400
    throw error
  }
  const required = legacy ? legacyRequired : keys
  for (const key of required) {
    if (!Array.isArray(value[key])) {
      const error = new Error(`Missing or malformed ${key}.`)
      error.status = 400
      throw error
    }
  }
  return Object.fromEntries(keys.map(key => [key, Array.isArray(value[key]) ? value[key] : []]))
}

function reply(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    const error = new Error('Content-Type must be application/json.')
    error.status = 415
    throw error
  }
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > maxBodyBytes) {
      const error = new Error('Request is too large.')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Invalid JSON.')
    error.status = 400
    throw error
  }
}

function checkRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    const error = new Error('A valid revision is required.')
    error.status = 400
    throw error
  }
  if (value !== current().revision) {
    const error = new Error('This dataset changed in another tab. Export your unsaved copy before reloading.')
    error.status = 409
    throw error
  }
}

function writeDocument(dataset) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const revision = getRow.get().revision + 1
    updateRow.run(revision, dataset === null ? null : JSON.stringify(dataset))
    db.exec('COMMIT')
    return revision
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const day = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: process.env.TZ || 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

async function makeBackup(name) {
  const destination = join(backupDir, name)
  const temporary = `${destination}.partial`
  try {
    await backup(db, temporary)
    renameSync(temporary, destination)
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary)
    throw error
  }
}

async function dailyBackup() {
  if (current().dataset === null) return
  const name = `daily-${day()}.sqlite`
  if (existsSync(join(backupDir, name))) return
  await makeBackup(name)
  const daily = readdirSync(backupDir).filter(name => /^daily-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)).sort()
  for (const old of daily.slice(0, -30)) rmSync(join(backupDir, old))
}

async function safetyBackup(reason) {
  if (current().dataset === null) return
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  await makeBackup(`${reason}-${timestamp}.sqlite`)
}

let operations = Promise.resolve()
function serialize(work) {
  const next = operations.then(work)
  operations = next.catch(() => {})
  return next
}

function availableBackups() {
  return readdirSync(backupDir)
    .filter(name => /^(daily-\d{4}-\d{2}-\d{2}|pre-(restore|clear)-[\dTZ-]+)\.sqlite$/.test(name))
    .sort().reverse()
}

function loadBackup(name) {
  if (!availableBackups().includes(name)) {
    const error = new Error('Backup not found.')
    error.status = 404
    throw error
  }
  const source = new DatabaseSync(join(backupDir, name), { readOnly: true })
  try {
    const row = source.prepare('SELECT document FROM dataset WHERE id = 1').get()
    if (!row?.document) throw new Error('Backup has no dataset.')
    return normalizeDataset(JSON.parse(row.document))
  } finally {
    source.close()
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
}

function serveStatic(req, res, pathname) {
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { return reply(res, 400, { error: 'Invalid URL.' }) }
  const candidate = resolve(publicDir, `.${decoded}`)
  if (candidate !== publicDir && !candidate.startsWith(publicDir + sep)) {
    return reply(res, 403, { error: 'Forbidden.' })
  }
  const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(publicDir, 'index.html')
  if (!existsSync(file)) return reply(res, 404, { error: 'App build not found.' })
  const body = readFileSync(file)
  res.writeHead(200, {
    'Content-Type': mime[extname(file)] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

function isLoopback(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase())
}

function originAllowed(req) {
  if (!req.headers.origin) return true
  try {
    const origin = new URL(req.headers.origin)
    const requestHost = new URL(`http://${req.headers.host}`)
    if (origin.host === req.headers.host) return true
    // The Vite development proxy runs the UI and API on different loopback
    // ports. Both endpoints remain local to this computer.
    return isLoopback(origin.hostname) && isLoopback(requestHost.hostname)
  } catch {
    return false
  }
}

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname
    if (pathname.startsWith('/api/')) {
      if (!originAllowed(req)) {
        return reply(res, 403, { error: 'Cross-origin requests are not allowed.' })
      }
      if (req.method === 'GET' && pathname === '/api/dataset') return reply(res, 200, current())
      if (req.method === 'GET' && pathname === '/api/backups') return reply(res, 200, { backups: availableBackups() })
      if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' })
      const body = await readJson(req)
      if (pathname === '/api/dataset') {
        const dataset = normalizeDataset(body.dataset)
        return reply(res, 200, await serialize(async () => {
          checkRevision(body.revision)
          const wasEmpty = current().dataset === null
          await dailyBackup()
          const revision = writeDocument(dataset)
          if (wasEmpty) await dailyBackup()
          return { revision }
        }))
      }
      if (pathname === '/api/restore' || pathname === '/api/restore-backup') {
        if (body.confirmation !== 'RESTORE') return reply(res, 400, { error: 'Type RESTORE to confirm.' })
        return reply(res, 200, await serialize(async () => {
          checkRevision(body.revision)
          const dataset = pathname === '/api/restore'
            ? normalizeDataset(body.dataset, true)
            : loadBackup(body.name)
          await safetyBackup('pre-restore')
          return { revision: writeDocument(dataset), dataset }
        }))
      }
      if (pathname === '/api/clear') {
        if (body.confirmation !== 'CLEAR') return reply(res, 400, { error: 'Type CLEAR to confirm.' })
        return reply(res, 200, await serialize(async () => {
          checkRevision(body.revision)
          await safetyBackup('pre-clear')
          return { revision: writeDocument(null) }
        }))
      }
      return reply(res, 404, { error: 'Not found.' })
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'Method not allowed.' })
    serveStatic(req, res, pathname)
  } catch (error) {
    console.error(error)
    reply(res, error.status || 500, { error: error.status ? error.message : 'Storage operation failed.' })
  }
})

server.listen(port, host, () => {
  console.log(`Okanemo listening on ${host}:${server.address().port}`)
  serialize(dailyBackup).catch(error => console.error('Daily backup failed:', error))
})
setInterval(() => serialize(dailyBackup).catch(error => console.error('Daily backup failed:', error)), 60 * 60 * 1000).unref()

function shutdown() {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
