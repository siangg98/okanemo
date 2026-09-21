import { STORAGE_KEYS } from './constants.js'

export function readLegacyBrowserData(storage) {
  let keyCount = 0
  let recordCount = 0
  const dataset = {}

  for (const [name, storageKey] of Object.entries(STORAGE_KEYS)) {
    const raw = storage.getItem(storageKey)
    const datasetKey = name.toLowerCase()
    if (raw === null) {
      dataset[datasetKey] = []
      continue
    }

    keyCount += 1
    let records
    try {
      records = JSON.parse(raw)
    } catch {
      throw new Error(`The old browser value "${storageKey}" is not valid JSON.`)
    }
    if (!Array.isArray(records)) {
      throw new Error(`The old browser value "${storageKey}" is not a record list.`)
    }
    dataset[datasetKey] = records
    recordCount += records.length
  }

  return keyCount === 0 ? null : { dataset, keyCount, recordCount }
}
