// ===== Variation Helpers =====

/**
 * Returns a display label for a variation, e.g. "Red / M"
 */
export function getVariationLabel(variation) {
  if (!variation) return ''
  const parts = [variation.tier1Value, variation.tier2Value].filter(Boolean)
  return parts.join(' / ')
}

/**
 * Finds a specific variation on a product by its id.
 */
export function getVariation(product, variationId) {
  if (!product || !product.hasVariations || !product.variations) return null
  return product.variations.find(v => v.id === variationId) || null
}

/**
 * Total units currently in stock for a single variation.
 */
export function calculateVariationStock(variation) {
  if (!variation || !variation.batches) return 0
  return variation.batches.reduce((sum, b) => sum + (b.remainingUnits || 0), 0)
}

/**
 * FIFO cost per unit for a single variation.
 */
export function calculateVariationCostPerUnit(variation, shipments = []) {
  if (!variation || !variation.batches || variation.batches.length === 0) return 0
  const sorted = [...variation.batches].sort(
    (a, b) => new Date(a.dateAdded) - new Date(b.dateAdded)
  )
  for (const batch of sorted) {
    if (batch.remainingUnits > 0) return calculateBatchCostPerUnit(batch, shipments)
  }
  return calculateBatchCostPerUnit(sorted[sorted.length - 1], shipments)
}

// ===== ID Generation =====
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

// ===== SKU Generation =====
// Builds HEAD-TAIL: HEAD from the leading words, TAIL from the trailing word — the
// one that usually distinguishes variants (Black/White/Small). A numeric suffix is
// added only when the result would otherwise collide.
// existingSkus: string[] of already-assigned SKUs, used to guarantee uniqueness
export function generateSKU(name = '', existingSkus = []) {
  const clean = s => s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8)
  const words = name.trim().split(/\s+/).filter(Boolean)

  let base
  if (words.length > 1) {
    const head = clean(words.slice(0, -1).join(''))
    const tail = clean(words[words.length - 1])
    base = head && tail ? `${head}-${tail}` : head || tail
  } else {
    base = clean(words[0] || '')
  }
  if (!base) base = 'PRD'

  const taken = new Set(existingSkus.filter(Boolean))
  if (!taken.has(base)) return base

  let n = 1
  while (taken.has(`${base}-${String(n).padStart(3, '0')}`)) n++
  return `${base}-${String(n).padStart(3, '0')}`
}

// Variation SKUs hang off the product's: SPACESAG-CASE-BLACK, and
// SPACESAG-CASE-BLACK-XL once a second tier is in play. Unlike the product
// head, the tier values are not truncated — they are the part a person reads
// to tell two rows apart, and clipping them to four characters turned Black
// and White into BLAC and WHIT. The tiers are hyphenated rather than run
// together for the same reason: Black + S should read BLACK-S, not BLACKS.
export function makeVariationSKU(productSku, tier1Value, tier2Value) {
  const clean = s => (s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  const parts = [clean(tier1Value), clean(tier2Value)].filter(Boolean)
  return parts.length > 0 ? `${productSku}-${parts.join('-')}` : `${productSku}-VAR`
}

// ===== CSV Export =====
export function exportCSV(filename, rows) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const escape = v => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ===== Formatting =====
export function formatMYR(amount) {
  return `RM ${parseFloat(amount || 0).toFixed(2)}`
}

const CURRENCY_SYMBOLS = {
  MYR: 'RM',
  CNY: '¥',
  USD: '$',
  JPY: 'JP¥',
  SGD: 'S$',
  EUR: '€',
  GBP: '£',
  THB: '฿',
}

/**
 * Format an amount in a foreign currency, e.g. "¥ 2000.00" or "1200.00 VND".
 */
export function formatForeign(amount, currency = 'CNY') {
  const n = parseFloat(amount) || 0
  const symbol = CURRENCY_SYMBOLS[currency]
  return symbol ? `${symbol} ${n.toFixed(2)}` : `${n.toFixed(2)} ${currency}`
}

/**
 * Format an exchange rate. Rates are small numbers, so 4 decimals.
 */
export function formatRate(rate, currency = 'CNY') {
  return `RM ${(parseFloat(rate) || 0).toFixed(4)}/${CURRENCY_SYMBOLS[currency] || currency}`
}

/**
 * Format an amount in whichever currency it's denominated in.
 * Use this wherever an account's own currency drives the display.
 */
export function formatAmount(amount, currency = 'MYR') {
  return currency === 'MYR' ? formatMYR(amount) : formatForeign(amount, currency)
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ===== Expense Categories =====
export const EXPENSE_CATEGORIES = {
  inventory: 'Inventory',
  packaging: 'Packaging',
  advertising: 'Advertising',
  tools: 'Tools',
  software: 'Software',
  transport: 'Transport',
  other: 'Other',
}

// ===== Shipment Helpers =====
export function getSupplierGroupForBatch(shipment, batch) {
  if (shipment.supplierGroups && batch.supplierGroupIndex !== undefined) {
    return shipment.supplierGroups[batch.supplierGroupIndex] ?? null
  }
  if (shipment.supplierGroups && shipment.supplierGroups.length > 0) {
    return shipment.supplierGroups[0]
  }
  // Very old format fallback
  return {
    supplierId: shipment.supplierId,
    reloadId: shipment.reloadId,
    sellerDiscountMYR: shipment.sellerDiscountCNY || 0,
    domesticShippingMYR: shipment.domesticShippingCNY || 0,
    items: shipment.items || [],
    totalValueMYR: shipment.totalValueCNY || 0,
  }
}

// ===== Cost Calculations =====

/**
 * Calculate cost per unit for a single batch.
 * Requires the full shipments array to look up shipping allocation.
 */
export function calculateBatchCostPerUnit(batch, shipments = []) {
  // Batches created by a consolidated shipment carry their landed cost frozen
  // at arrival. Nothing downstream can drift it, and no shipment lookup is
  // needed. Everything below is the pre-consolidation path, untouched.
  if (batch.landedCostMYR != null) return batch.landedCostMYR

  if (batch.isLocal) {
    const packSize = batch.packSize || 1
    const totalUnits = (batch.quantity || 0) * packSize
    const purchasePerUnit = (batch.purchasePriceMYR || 0) / packSize
    const localCostPerUnit = totalUnits > 0 ? (batch.localCost || 0) / totalUnits : 0
    return purchasePerUnit + localCostPerUnit
  }

  // Legacy CNY batches (had reloadId) — no exchange rate available
  if (!batch.purchasePriceMYR && batch.reloadId) return 0

  const purchasePriceMYR = batch.purchasePriceMYR || 0
  const shipment = shipments.find(s => s.id === batch.shipmentId)
  if (!shipment) return purchasePriceMYR

  const group = getSupplierGroupForBatch(shipment, batch)
  if (!group) return purchasePriceMYR

  const batchValueMYR = purchasePriceMYR * batch.quantity

  // Prorate against items-only value, not grand total.
  // grandTotal = items + domesticShipping - discount → items = grandTotal - domesticShipping + discount
  const domesticShippingMYR = group.domesticShippingMYR || 0
  const sellerDiscountMYR = group.sellerDiscountMYR || 0
  const itemsSubtotalMYR =
    (group.totalValueMYR || 0) - domesticShippingMYR + sellerDiscountMYR
  const prorationBase = itemsSubtotalMYR > 0 ? itemsSubtotalMYR : (group.totalValueMYR || 0)

  const discountShare =
    prorationBase > 0 && sellerDiscountMYR
      ? (batchValueMYR / prorationBase) * sellerDiscountMYR
      : 0

  const packageCount = shipment.supplierGroups ? shipment.supplierGroups.length : 1
  const internationalPerPackage = (shipment.shippingCost || 0) / packageCount
  const totalShippingMYR = domesticShippingMYR + internationalPerPackage

  const shippingShare =
    prorationBase > 0 ? (batchValueMYR / prorationBase) * totalShippingMYR : 0

  // purchasePriceMYR is per pack, while batchValueMYR, discountShare and
  // shippingShare are all batch totals. Divide by units rather than packs so
  // the result stays per-unit whatever the pack size.
  const totalUnitsInBatch = batch.quantity * (batch.packSize || 1)
  if (totalUnitsInBatch <= 0) return 0

  return (batchValueMYR - discountShare + shippingShare) / totalUnitsInBatch
}

/**
 * FIFO: cost per unit from the oldest batch that still has stock.
 */
export function calculateFIFOCostPerUnit(product, shipments = []) {
  if (!product.batches || product.batches.length === 0) return 0

  const sorted = [...product.batches].sort(
    (a, b) => new Date(a.dateAdded) - new Date(b.dateAdded)
  )

  for (const batch of sorted) {
    if (batch.remainingUnits > 0) {
      return calculateBatchCostPerUnit(batch, shipments)
    }
  }

  return calculateBatchCostPerUnit(sorted[sorted.length - 1], shipments)
}

/**
 * Cost per unit for a product.
 * For variation products, returns the stock-weighted average cost across all
 * variations (or the first variation's cost if none have stock).
 */
export function calculateProductCostPerUnit(product, shipments = []) {
  if (product.hasVariations && product.variations && product.variations.length > 0) {
    const withStock = product.variations.filter(v => calculateVariationStock(v) > 0)
    if (withStock.length > 0) {
      const totalStock = withStock.reduce((sum, v) => sum + calculateVariationStock(v), 0)
      const totalCost = withStock.reduce(
        (sum, v) => sum + calculateVariationCostPerUnit(v, shipments) * calculateVariationStock(v),
        0
      )
      return totalStock > 0 ? totalCost / totalStock : 0
    }
    return calculateVariationCostPerUnit(product.variations[0], shipments)
  }
  if (product.batches && product.batches.length > 0) {
    return calculateFIFOCostPerUnit(product, shipments)
  }
  return product.purchasePriceMYR || 0
}

/**
 * Total units currently in stock for a product.
 * For variation products, sums across all variations.
 */
export function calculateStock(product, sales = []) {
  if (product.hasVariations && product.variations) {
    return product.variations.reduce((sum, v) => sum + calculateVariationStock(v), 0)
  }

  if (product.batches && product.batches.length > 0) {
    return product.batches.reduce((sum, b) => sum + (b.remainingUnits || 0), 0)
  }

  // Legacy: derive from quantity minus sales
  const totalUnits = (product.quantity || 0) * (product.packSize || 1)
  let soldUnits = 0
  sales.forEach(s => {
    if (s.items && s.items.length > 0) {
      s.items.forEach(item => {
        if (item.productId === product.id) soldUnits += item.quantity
      })
    } else if (s.productId === product.id) {
      soldUnits += s.quantity || 0
    }
  })
  return totalUnits - soldUnits
}

// ===== Sale Batch Draws =====

/**
 * FIFO draw of `units` from a product's batches, or from one variation's,
 * oldest first.
 *
 * Mirrors drawFromReloads: alongside the updated product it returns the exact
 * draws taken, so deleting or editing the sale can put back precisely what was
 * consumed rather than guessing at it.
 *
 * `unitsDrawn` falls short of `units` when the sale oversells — batches floor
 * at zero and the caller prices the remainder.
 */
export function drawFromBatches(product, variationId, units, shipments = []) {
  const needed = Math.max(0, parseInt(units) || 0)
  if (!product || needed <= 0) return { product, draws: [], costAccum: 0, unitsDrawn: 0 }

  const draws = []
  let remaining = needed
  let costAccum = 0

  const draw = batches => {
    const takenById = {}
    ;[...batches]
      .sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded))
      .forEach(b => {
        if (remaining <= 0 || (b.remainingUnits || 0) <= 0) return
        const taken = Math.min(b.remainingUnits, remaining)
        remaining -= taken
        costAccum += taken * calculateBatchCostPerUnit(b, shipments)
        takenById[b.id] = taken
        draws.push({ batchId: b.id, units: taken })
      })
    return batches.map(b =>
      takenById[b.id] ? { ...b, remainingUnits: b.remainingUnits - takenById[b.id] } : b
    )
  }

  let next = product
  if (variationId && product.hasVariations) {
    next = {
      ...product,
      variations: (product.variations || []).map(v =>
        v.id === variationId && v.batches ? { ...v, batches: draw(v.batches) } : v
      ),
    }
  } else if (product.batches) {
    next = { ...product, batches: draw(product.batches) }
  }

  return { product: next, draws, costAccum, unitsDrawn: needed - remaining }
}

/**
 * Put back exactly the units a sale drew, using the draws it recorded.
 * The inverse of drawFromBatches.
 */
export function restoreToBatches(product, variationId, draws = []) {
  if (!product || !draws || draws.length === 0) return product

  const byId = {}
  draws.forEach(d => {
    byId[d.batchId] = (byId[d.batchId] || 0) + (parseFloat(d.units) || 0)
  })

  const restore = batches =>
    batches.map(b =>
      byId[b.id] ? { ...b, remainingUnits: (b.remainingUnits || 0) + byId[b.id] } : b
    )

  if (variationId && product.hasVariations) {
    return {
      ...product,
      variations: (product.variations || []).map(v =>
        v.id === variationId && v.batches ? { ...v, batches: restore(v.batches) } : v
      ),
    }
  }
  return product.batches ? { ...product, batches: restore(product.batches) } : product
}

/**
 * Restore for sales recorded before draws were tracked. Units go back
 * oldest-first — where FIFO would have taken them — and no batch is pushed
 * above the quantity it arrived with. A pre-draws sale cannot say how many
 * units it actually consumed, so any excess is dropped rather than invented
 * as new stock.
 */
export function restoreToBatchesLegacy(product, variationId, units) {
  const needed = Math.max(0, parseInt(units) || 0)
  if (!product || needed <= 0) return product

  let remaining = needed
  const share = batches =>
    [...batches]
      .sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded))
      .reduce((acc, b) => {
        const capacity = (b.quantity || 0) * (b.packSize || 1) - (b.remainingUnits || 0)
        const given = Math.max(0, Math.min(capacity, remaining))
        remaining -= given
        if (given > 0) acc[b.id] = given
        return acc
      }, {})

  const apply = (batches, given) =>
    batches.map(b =>
      given[b.id] ? { ...b, remainingUnits: (b.remainingUnits || 0) + given[b.id] } : b
    )

  if (variationId && product.hasVariations) {
    const target = (product.variations || []).find(v => v.id === variationId)
    if (!target || !target.batches) return product
    const given = share(target.batches)
    return {
      ...product,
      variations: product.variations.map(v =>
        v.id === variationId ? { ...v, batches: apply(v.batches, given) } : v
      ),
    }
  }

  if (product.batches && product.batches.length > 0) {
    return { ...product, batches: apply(product.batches, share(product.batches)) }
  }

  // Pre-batch products tracked a flat quantity
  return { ...product, quantity: (product.quantity || 0) + needed }
}

// ===== Sale Helpers =====

/**
 * Compute totalFees, netRevenue, totalCost, and profit for a sale.
 * Cost uses the costPerUnit snapshot taken when the sale was recorded;
 * products and shipments are only needed as a fallback for unmigrated sales.
 */
export function calculateSaleTotals(sale, products = [], shipments = []) {
  let totalCost = 0

  if (sale.items && sale.items.length > 0) {
    sale.items.forEach(item => {
      let costPerUnit = item.costPerUnit
      if (costPerUnit == null) {
        const product = products.find(p => p.id === item.productId)
        costPerUnit = product ? calculateProductCostPerUnit(product, shipments) : 0
      }
      totalCost += costPerUnit * item.quantity
    })
  } else if (sale.productId) {
    // Legacy single-product format
    let costPerUnit = sale.costPerUnit
    if (costPerUnit == null) {
      const product = products.find(p => p.id === sale.productId)
      costPerUnit = product ? calculateProductCostPerUnit(product, shipments) : 0
    }
    totalCost = costPerUnit * (sale.quantity || 0)
  }

  const fees = sale.fees || {}
  const commission = fees.commission || 0
  const transaction = fees.transaction || 0
  const service = fees.service || 0
  const saver = fees.saver || 0
  const voucher = fees.voucher || 0
  const legacyShipping = fees.shipping || 0

  const totalFees = commission + transaction + service + saver + voucher + legacyShipping
  const netRevenue = (sale.sellingPrice || 0) - totalFees
  const profit = netRevenue - totalCost

  return { totalFees, netRevenue, totalCost, profit }
}

/**
 * Net revenue a sale deposits into its account: sellingPrice − all fees.
 * Does not require products/shipments (no COGS involved).
 */
export function calculateSaleNetRevenue(sale) {
  const fees = sale.fees || {}
  const totalFees =
    (fees.commission || 0) +
    (fees.transaction || 0) +
    (fees.service || 0) +
    (fees.saver || 0) +
    (fees.voucher || 0) +
    (fees.shipping || 0)
  return (sale.sellingPrice || 0) - totalFees
}

export function getTotalQuantity(sale) {
  if (sale.items && sale.items.length > 0) {
    return sale.items.reduce((sum, item) => sum + item.quantity, 0)
  }
  return sale.quantity || 0
}

export function getProductsSummary(sale, products = []) {
  if (sale.items && sale.items.length > 0) {
    if (sale.items.length === 1) {
      const item = sale.items[0]
      const product = products.find(p => p.id === item.productId)
      if (!product) return 'Unknown'
      if (item.variationId && product.hasVariations) {
        const variation = getVariation(product, item.variationId)
        return variation ? `${product.name} (${getVariationLabel(variation)})` : product.name
      }
      return product.name
    }
    return `${sale.items.length} products`
  }
  // Legacy
  const product = products.find(p => p.id === sale.productId)
  return product ? product.name : 'Unknown'
}

// ===== Reload (currency top-up) Helpers =====

/**
 * Fees charged on a reload, however they were quoted.
 */
export function calculateReloadFeesMYR(reload) {
  if (!reload) return 0
  return (parseFloat(reload.agentFeeMYR) || 0) + (parseFloat(reload.bankFeeMYR) || 0)
}

/**
 * Total MYR that actually left the bank for a reload — the figure balances,
 * COGS and the account ledger all run on.
 *
 * `myrPaid` is always the whole outlay, fees included. Agents quote either way
 * (fee on top of the amount converted, or taken out of what you pay), but only
 * one of those is a fact about your bank, so that is the one stored.
 * `migrateReloadFeesInclusive` folds older additive records into this shape.
 */
export function calculateReloadTotalMYR(reload) {
  if (!reload) return 0
  return parseFloat(reload.myrPaid) || 0
}

/**
 * MYR that actually became foreign currency — the outlay less its fees. This is
 * the figure the agent's headline rate is quoted against.
 */
export function calculateReloadConvertedMYR(reload) {
  if (!reload) return 0
  return calculateReloadTotalMYR(reload) - calculateReloadFeesMYR(reload)
}

/**
 * True MYR cost of one unit of foreign currency for a reload, fees included.
 * This — not the agent's headline quote — is what a yuan actually costs.
 */
export function calculateReloadCostRate(reload) {
  const amount = parseFloat(reload?.amountForeign) || 0
  if (amount <= 0) return 0
  return calculateReloadTotalMYR(reload) / amount
}

/**
 * Wallet summary for one currency across all reloads.
 * `blendedRate` is weighted by what's left, so it answers "what did the yuan
 * I still hold cost me", not "what did I pay on average historically".
 */
export function calculateWallet(reloads = [], currency = 'CNY') {
  const pool = reloads.filter(r => r.currency === currency)

  let totalForeign = 0
  let remainingForeign = 0
  let totalPaidMYR = 0
  let totalFeesMYR = 0
  let tiedUpMYR = 0

  pool.forEach(r => {
    const remaining = parseFloat(r.remainingForeign) || 0
    totalForeign += parseFloat(r.amountForeign) || 0
    remainingForeign += remaining
    totalPaidMYR += calculateReloadTotalMYR(r)
    totalFeesMYR += calculateReloadFeesMYR(r)
    tiedUpMYR += remaining * calculateReloadCostRate(r)
  })

  return {
    currency,
    reloadCount: pool.length,
    totalForeign,
    remainingForeign,
    spentForeign: totalForeign - remainingForeign,
    totalPaidMYR,
    totalFeesMYR,
    tiedUpMYR,
    blendedRate: remainingForeign > 0 ? tiedUpMYR / remainingForeign : 0,
  }
}

/**
 * Snap a money amount back to cents.
 *
 * Every currency this app touches is two-decimal, but the FIFO chain subtracts
 * and re-adds balances repeatedly, and binary floats do not survive that: a
 * wallet drawn exactly to empty comes out as 1.4e-13 rather than 0, and a
 * backup export shows `70.85000000000014`. Rounding at each step that gets
 * *stored* keeps the arithmetic honest to the cent.
 *
 * Only for amounts. Rates keep their full precision.
 */
export function roundCurrency(value) {
  return Math.round((parseFloat(value) || 0) * 100) / 100
}

/**
 * FIFO draw of `amountForeign` from one wallet's reloads, oldest reload first.
 *
 * An order consuming yuan is structurally identical to a sale consuming
 * inventory batches (see ADD_SALE), so it uses the same shape: draw oldest
 * first and accumulate a weighted rate for the exact currency consumed.
 *
 * If the wallet is short, the uncovered amount is priced at the newest
 * reload's rate and reported via `shortfall` — mirroring the oversold
 * fallback in ADD_SALE rather than silently costing it at zero.
 *
 * Returns { reloads, draws, rateMYR, shortfall }.
 */
export function drawFromReloads(reloads = [], walletAccountId, amountForeign) {
  const needed = roundCurrency(amountForeign)
  if (needed <= 0) return { reloads, draws: [], rateMYR: 0, shortfall: 0 }

  const draws = []
  const drawnById = {}
  let remaining = needed
  let costAccum = 0

  const inWallet = r => r.walletAccountId === walletAccountId

  const available = [...reloads]
    .filter(r => inWallet(r) && (parseFloat(r.remainingForeign) || 0) > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  for (const reload of available) {
    if (remaining <= 0) break
    const taken = roundCurrency(Math.min(parseFloat(reload.remainingForeign) || 0, remaining))
    const costRate = calculateReloadCostRate(reload)
    // Rounding here as well as on the balance keeps `remaining` landing on a
    // clean zero, so an exactly-drained wallet ends the loop instead of
    // dribbling a 1e-14 draw into the next reload.
    remaining = roundCurrency(remaining - taken)
    costAccum += taken * costRate
    drawnById[reload.id] = taken
    draws.push({ reloadId: reload.id, amountForeign: taken, costRate })
  }

  if (remaining > 0) {
    const newest = [...reloads]
      .filter(inWallet)
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    costAccum += remaining * (newest ? calculateReloadCostRate(newest) : 0)
  }

  const updated = reloads.map(r =>
    drawnById[r.id]
      ? { ...r, remainingForeign: roundCurrency((parseFloat(r.remainingForeign) || 0) - drawnById[r.id]) }
      : r
  )

  // rateMYR is a rate, not an amount — it needs its full precision, since two
  // extra decimals there move the cost of a whole shipment.
  return { reloads: updated, draws, rateMYR: costAccum / needed, shortfall: remaining }
}

/**
 * Put drawn foreign currency back into its reloads — the inverse of
 * drawFromReloads, used when an order is deleted or re-costed.
 */
export function restoreToReloads(reloads = [], draws = []) {
  if (!draws || draws.length === 0) return reloads

  const byId = {}
  draws.forEach(d => {
    byId[d.reloadId] = (byId[d.reloadId] || 0) + (parseFloat(d.amountForeign) || 0)
  })

  return reloads.map(r =>
    byId[r.id]
      ? { ...r, remainingForeign: roundCurrency((parseFloat(r.remainingForeign) || 0) + byId[r.id]) }
      : r
  )
}

// ===== Purchase Order Helpers =====

/**
 * Value of the item lines alone, in the order's own currency.
 */
export function calculateOrderItemsSubtotal(order) {
  if (!order?.items) return 0
  return order.items.reduce(
    (sum, i) => sum + (parseFloat(i.qty) || 0) * (parseFloat(i.unitPrice) || 0),
    0
  )
}

/**
 * Everything on the checkout page that isn't an item line: domestic shipping,
 * less the seller discount, plus `otherAdjust` — the catch-all that reconciles
 * against the screenshot total so platform fees and vouchers don't each need
 * their own field.
 */
export function calculateOrderOverhead(order) {
  return (
    (parseFloat(order?.domesticShipping) || 0) -
    (parseFloat(order?.sellerDiscount) || 0) +
    (parseFloat(order?.otherAdjust) || 0)
  )
}

/**
 * What the order costs in its own currency — the figure that must match the
 * checkout screenshot, and the amount drawn from the wallet.
 */
export function calculateOrderTotal(order) {
  return calculateOrderItemsSubtotal(order) + calculateOrderOverhead(order)
}

/**
 * Gap between the entered checkout total and what the lines actually add up
 * to. Positive means the screenshot is higher than the lines — unaccounted
 * fees. Zero once "Balance the difference" has been applied.
 */
export function calculateOrderDelta(order) {
  if (order?.checkoutTotal == null || order.checkoutTotal === '') return 0
  return (parseFloat(order.checkoutTotal) || 0) - calculateOrderTotal(order)
}

/**
 * Cost of one unit in the order's currency, overheads prorated by line value.
 */
export function calculateOrderItemUnitCost(order, item) {
  const unitPrice = parseFloat(item?.unitPrice) || 0
  const subtotal = calculateOrderItemsSubtotal(order)
  if (subtotal <= 0) return unitPrice
  return unitPrice * (calculateOrderTotal(order) / subtotal)
}

/**
 * Cost of one unit in MYR, at the rate this order drew from the wallet.
 * Agent and bank fees are already inside that rate.
 */
export function calculateOrderItemUnitCostMYR(order, item) {
  return calculateOrderItemUnitCost(order, item) * (parseFloat(order?.rateMYR) || 0)
}

/**
 * True when an expense was paid out of a foreign wallet rather than in MYR.
 * Such an expense spends the same yuan an order would, so it has to replay
 * against the reload pool alongside them.
 */
export function isForeignExpense(expense) {
  return (expense?.currency || 'MYR') !== 'MYR'
}

/**
 * Rebuild the whole wallet by replaying every order and foreign-currency
 * expense against the reload pool in date order, re-deriving each one's rate
 * and draws.
 *
 * Patching individual draws would drift: editing an order, or logging a reload
 * late, changes which top-up funded which purchase. Replaying is O(spends ×
 * reloads) — trivial at this scale — and self-heals out-of-order entry, which
 * matters because reloads, orders and expenses get logged as they happen.
 *
 * Orders and foreign expenses replay as one sequence because they share one
 * wallet: a ¥9.90 membership spends the same yuan a purchase order would, so
 * costing them separately would hand the same currency out twice. MYR expenses
 * never touch a reload and pass through untouched.
 *
 * History stays protected downstream: batches snapshot `landedCostMYR` when a
 * shipment arrives and sales snapshot `costPerUnit`, so replaying only ever
 * re-costs stock that hasn't landed or sold yet.
 *
 * Returns { reloads, orders, expenses } with all three slices updated.
 */
export function recomputeReloadDraws(reloads = [], orders = [], expenses = []) {
  let pool = reloads.map(r => ({
    ...r,
    remainingForeign: parseFloat(r.amountForeign) || 0,
  }))

  const sequence = [
    ...orders
      .filter(o => o.status !== 'cancelled')
      .map(o => ({
        key: `order:${o.id}`,
        record: o,
        wallet: o.walletAccountId,
        amount: calculateOrderTotal(o),
      })),
    ...expenses.filter(isForeignExpense).map(e => ({
      key: `expense:${e.id}`,
      record: e,
      wallet: e.accountId,
      amount: parseFloat(e.amountForeign) || 0,
    })),
  ].sort((a, b) => {
    const byDate = new Date(a.record.date) - new Date(b.record.date)
    return byDate !== 0 ? byDate : String(a.record.id).localeCompare(String(b.record.id))
  })

  const costed = {}
  sequence.forEach(({ key, wallet, amount }) => {
    const result = drawFromReloads(pool, wallet, amount)
    pool = result.reloads
    costed[key] = {
      rateMYR: result.rateMYR,
      reloadDraws: result.draws,
      shortfallForeign: result.shortfall,
    }
  })

  const empty = { rateMYR: 0, reloadDraws: [], shortfallForeign: 0 }

  return {
    reloads: pool,
    orders: orders.map(o => ({ ...o, ...(costed[`order:${o.id}`] || empty) })),
    // A foreign expense's MYR value is derived here, never typed in — which is
    // the point: the rate depends on which reloads happened to fund it, and
    // that answer changes when anything upstream is edited.
    expenses: expenses.map(e => {
      if (!isForeignExpense(e)) return e
      const snapshot = costed[`expense:${e.id}`] || empty
      return {
        ...e,
        ...snapshot,
        amount: roundCurrency((parseFloat(e.amountForeign) || 0) * snapshot.rateMYR),
      }
    }),
  }
}

// ===== Consolidated Shipment Helpers =====

/**
 * Resolve the order and item a shipment line points at.
 */
export function resolveShipmentLine(line, orders = []) {
  const order = orders.find(o => o.id === line.orderId)
  if (!order) return { order: null, item: null }
  return { order, item: order.items?.find(i => i.id === line.itemId) || null }
}

/**
 * MYR paid for the units on this line, before freight.
 */
export function calculateShipmentLineValue(line, orders = []) {
  const { order, item } = resolveShipmentLine(line, orders)
  if (!order || !item) return 0
  return (parseFloat(line.qty) || 0) * calculateOrderItemUnitCostMYR(order, item)
}

/**
 * Total goods value in the box — the base freight is prorated against.
 */
export function calculateShipmentValue(shipment, orders = []) {
  if (!shipment?.lines) return 0
  return shipment.lines.reduce((sum, l) => sum + calculateShipmentLineValue(l, orders), 0)
}

/**
 * Landed cost per unit actually received: what those units cost, plus their
 * share of freight prorated by value across the whole shipment, divided by how
 * many turned up.
 *
 * A short shipment therefore pushes the missing units' cost onto the ones that
 * arrived — you paid for them either way, so the stock that landed has to carry
 * it or the margin is a fiction.
 */
export function calculateLandedCostPerUnit(line, shipment, orders = []) {
  const received = parseFloat(line.qtyReceived ?? line.qty) || 0
  if (received <= 0) return 0

  const lineValue = calculateShipmentLineValue(line, orders)
  const shipmentValue = calculateShipmentValue(shipment, orders)
  const freight = parseFloat(shipment?.freightMYR) || 0
  const freightShare = shipmentValue > 0 ? (lineValue / shipmentValue) * freight : 0

  return (lineValue + freightShare) / received
}

/**
 * Units of an order item already committed to shipments. `excludeShipmentId`
 * lets the shipment being edited ignore its own lines.
 */
export function calculateShippedQty(orderId, itemId, shipments = [], excludeShipmentId = null) {
  return shipments.reduce((sum, s) => {
    if (s.id === excludeShipmentId || !s.lines) return sum
    return (
      sum +
      s.lines.reduce(
        (n, l) => n + (l.orderId === orderId && l.itemId === itemId ? parseFloat(l.qty) || 0 : 0),
        0
      )
    )
  }, 0)
}

/**
 * Units still sitting in the China warehouse, free to consolidate.
 */
export function calculateAvailableQty(order, item, shipments = [], excludeShipmentId = null) {
  return (
    (parseFloat(item.qty) || 0) -
    calculateShippedQty(order.id, item.id, shipments, excludeShipmentId)
  )
}

/**
 * True once every item on an order has been fully consolidated into shipments.
 */
export function isOrderFullyShipped(order, shipments = []) {
  if (!order.items || order.items.length === 0) return false
  return order.items.every(i => calculateAvailableQty(order, i, shipments) <= 0)
}

/**
 * Legacy shipments predate consolidation and carry supplierGroups instead of
 * lines. They still render and still cost correctly, but the new UI treats
 * them as read-only history.
 */
export function isLegacyShipment(shipment) {
  if (shipment?.lines && shipment.lines.length > 0) return false
  // Supplier groups only mark a shipment as legacy if they actually carry items
  return (shipment?.supplierGroups || []).some(g => (g.items || []).length > 0)
}

// ===== Pipeline & Month Summary =====

/**
 * Money committed to China that hasn't landed in Malaysia yet — unspent
 * currency in the wallet, goods waiting at the warehouse, and goods on the
 * water. None of it shows up as inventory, so without this it is invisible.
 *
 * Units from an arrived shipment are excluded even when some went missing:
 * their cost is already carried by the stock that did turn up.
 */
export function calculateChinaPipeline(orders = [], shipments = [], reloads = [], accounts = []) {
  const arrived = new Set(shipments.filter(s => s.status === 'arrived').map(s => s.id))

  let atWarehouseMYR = 0
  let inTransitMYR = 0
  let pendingUnits = 0

  orders.forEach(order => {
    if (order.status === 'cancelled') return
    ;(order.items || []).forEach(item => {
      const unitCost = calculateOrderItemUnitCostMYR(order, item)

      let landedQty = 0
      let transitQty = 0
      shipments.forEach(s => {
        ;(s.lines || []).forEach(l => {
          if (l.orderId !== order.id || l.itemId !== item.id) return
          const qty = parseFloat(l.qty) || 0
          if (arrived.has(s.id)) landedQty += qty
          else transitQty += qty
        })
      })

      const notLanded = Math.max(0, (parseFloat(item.qty) || 0) - landedQty)
      const inTransit = Math.min(transitQty, notLanded)
      const waiting = notLanded - inTransit

      atWarehouseMYR += waiting * unitCost
      inTransitMYR += inTransit * unitCost
      pendingUnits += notLanded
    })
  })

  const walletMYR = accounts
    .filter(a => (a.currency || 'MYR') !== 'MYR')
    .reduce((sum, a) => sum + calculateWalletValueMYR(a.id, reloads), 0)

  return {
    walletMYR,
    atWarehouseMYR,
    inTransitMYR,
    pendingUnits,
    totalMYR: walletMYR + atWarehouseMYR + inTransitMYR,
  }
}

/**
 * The most recent YYYY-MM with any purchasing activity, so the summary stays
 * useful when you enter last month's paperwork in the first week of this one.
 */
export function latestPurchasingMonth(reloads = [], orders = [], shipments = []) {
  const dates = [
    ...reloads.map(r => r.date),
    ...orders.map(o => o.date),
    ...shipments.map(s => s.dateArrived || s.dateShipped || s.date),
  ].filter(d => typeof d === 'string' && d.length >= 7)

  if (dates.length === 0) return null
  return dates.sort()[dates.length - 1].slice(0, 7)
}

/**
 * One month of purchasing: currency bought and spent, freight paid, and what
 * actually landed. `month` is 'YYYY-MM'.
 */
export function calculatePurchasingMonth(month, reloads = [], orders = [], shipments = []) {
  const inMonth = d => typeof d === 'string' && d.startsWith(month)

  const monthReloads = reloads.filter(r => inMonth(r.date))
  const foreignBought = monthReloads.reduce((s, r) => s + (parseFloat(r.amountForeign) || 0), 0)
  const myrPaid = monthReloads.reduce((s, r) => s + calculateReloadTotalMYR(r), 0)

  const foreignSpent = orders
    .filter(o => inMonth(o.date) && o.status !== 'cancelled')
    .reduce((s, o) => s + calculateOrderTotal(o), 0)

  const freightMYR = shipments
    .filter(s => s.status !== 'draft' && inMonth(s.dateShipped || s.date))
    .reduce((s, x) => s + (parseFloat(x.freightMYR) || 0), 0)

  let unitsLanded = 0
  let landedValueMYR = 0
  shipments
    .filter(s => s.status === 'arrived' && inMonth(s.dateArrived))
    .forEach(s => {
      ;(s.lines || []).forEach(l => {
        const qty = parseFloat(l.qtyReceived ?? l.qty) || 0
        unitsLanded += qty
        landedValueMYR += qty * calculateLandedCostPerUnit(l, s, orders)
      })
    })

  return {
    month,
    foreignBought,
    myrPaid,
    foreignSpent,
    freightMYR,
    unitsLanded,
    landedValueMYR,
    avgLandedMYR: unitsLanded > 0 ? landedValueMYR / unitsLanded : 0,
  }
}

// ===== Account Helpers =====

/**
 * Current balance for an account, denominated in that account's own currency.
 *
 * MYR accounts:     adjustments + sale income − expenses − reloads paid out.
 * Foreign wallets:  adjustments + whatever is left of the reloads paid into it.
 *
 * A reload is a transfer, not an expense — it moves value between two accounts
 * rather than consuming it, so it is deducted here directly instead of via a
 * linked expense record. Cost is only recognised as COGS when goods sell.
 */
export function calculateAccountBalance(
  accountId,
  accounts = [],
  expenses = [],
  sales = [],
  reloads = []
) {
  const account = accounts.find(a => a.id === accountId)
  if (!account) return 0

  const currency = account.currency || 'MYR'
  let balance = 0

  if (account.adjustments && account.adjustments.length > 0) {
    account.adjustments.forEach(adj => {
      balance += adj.amount
    })
  }

  if (currency === 'MYR') {
    sales.forEach(s => {
      if (s.accountId === accountId) balance += calculateSaleNetRevenue(s)
    })

    // A foreign expense already came out of a wallet's reloads — subtracting
    // its MYR value here too would charge the same spend twice.
    expenses.forEach(e => {
      if (e.accountId === accountId && !isForeignExpense(e)) balance -= e.amount
    })

    reloads.forEach(r => {
      if (r.accountId === accountId) balance -= calculateReloadTotalMYR(r)
    })
  } else {
    // remainingForeign is drawn down as orders and foreign expenses spend it,
    // so the wallet balance stays correct without a separate ledger.
    reloads.forEach(r => {
      if (r.walletAccountId === accountId) balance += parseFloat(r.remainingForeign) || 0
    })
  }

  return balance
}

/**
 * MYR value of a foreign wallet at what the currency actually cost to acquire.
 */
export function calculateWalletValueMYR(accountId, reloads = []) {
  return reloads.reduce((sum, r) => {
    if (r.walletAccountId !== accountId) return sum
    return sum + (parseFloat(r.remainingForeign) || 0) * calculateReloadCostRate(r)
  }, 0)
}

/**
 * Build a flat sorted transaction list: sale income + adjustments + expenses +
 * reload transfers. Every row carries the currency it is denominated in, since
 * foreign wallets sit in the same ledger as MYR accounts.
 *
 * A reload emits two rows — value out of the bank, value into the wallet — so
 * each account's ledger reads correctly on its own.
 */
export function buildTransactionList(accounts = [], expenses = [], sales = [], reloads = []) {
  const txList = []
  const findAccount = id => accounts.find(a => a.id === id)
  // Plain text, no icon: rows end up in CSV exports and `<option>` labels, and
  // every row carries accountId for anything that wants to draw the icon too.
  const label = a => a.name

  sales.forEach(s => {
    if (!s.accountId) return
    const account = findAccount(s.accountId)
    if (!account) return
    txList.push({
      id: `sale-${s.id}`,
      date: s.date,
      type: 'income',
      accountId: s.accountId,
      accountName: label(account),
      currency: account.currency || 'MYR',
      amount: calculateSaleNetRevenue(s),
      description: s.reference ? `Sale: ${s.reference}` : 'Sale',
      isPositive: true,
    })
  })

  accounts.forEach(a => {
    if (a.adjustments && a.adjustments.length > 0) {
      a.adjustments.forEach(adj => {
        txList.push({
          id: adj.id,
          date: adj.date,
          type: 'adjustment',
          accountId: a.id,
          accountName: label(a),
          currency: a.currency || 'MYR',
          amount: Math.abs(adj.amount),
          description: adj.reason || 'Manual adjustment',
          isPositive: adj.amount >= 0,
        })
      })
    }
  })

  expenses.forEach(e => {
    if (!e.accountId) return
    const account = findAccount(e.accountId)
    if (!account) return
    txList.push({
      id: e.id,
      date: e.date,
      type: 'expense',
      accountId: e.accountId,
      accountName: label(account),
      currency: account.currency || 'MYR',
      amount: e.amount,
      description: e.description,
      isPositive: false,
    })
  })

  reloads.forEach(r => {
    const from = findAccount(r.accountId)
    const to = findAccount(r.walletAccountId)
    const foreign = formatForeign(r.amountForeign, r.currency)

    if (from) {
      txList.push({
        id: `reload-out-${r.id}`,
        date: r.date,
        type: 'transfer',
        accountId: from.id,
        accountName: label(from),
        currency: from.currency || 'MYR',
        amount: calculateReloadTotalMYR(r),
        description: `Reload → ${to ? to.name : 'wallet'} (${foreign})`,
        isPositive: false,
      })
    }

    if (to) {
      txList.push({
        id: `reload-in-${r.id}`,
        date: r.date,
        type: 'transfer',
        accountId: to.id,
        accountName: label(to),
        currency: r.currency,
        amount: parseFloat(r.amountForeign) || 0,
        description: `Reload from ${from ? from.name : 'bank'} @ ${formatRate(calculateReloadCostRate(r), r.currency)}`,
        isPositive: true,
      })
    }
  })

  return txList.sort((a, b) => new Date(b.date) - new Date(a.date))
}
