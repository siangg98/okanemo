import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readLegacyBrowserData } from '../src/utils/legacyBrowserData.js'

function storage(values) {
  return { getItem: key => Object.hasOwn(values, key) ? values[key] : null }
}

test('reads all legacy Okanemo lists and supplies empty optional lists', () => {
  const result = readLegacyBrowserData(storage({
    okanemo_suppliers: JSON.stringify([{ id: 'one' }]),
    okanemo_products: JSON.stringify([{ id: 'two' }, { id: 'three' }]),
  }))
  assert.equal(result.keyCount, 2)
  assert.equal(result.recordCount, 3)
  assert.deepEqual(result.dataset.suppliers, [{ id: 'one' }])
  assert.deepEqual(result.dataset.products, [{ id: 'two' }, { id: 'three' }])
  assert.deepEqual(result.dataset.orders, [])
})

test('returns null when the current browser origin has no legacy data', () => {
  assert.equal(readLegacyBrowserData(storage({})), null)
})

test('refuses malformed legacy data instead of silently losing it', () => {
  assert.throws(
    () => readLegacyBrowserData(storage({ okanemo_sales: '{bad json' })),
    /okanemo_sales.*not valid JSON/
  )
})
