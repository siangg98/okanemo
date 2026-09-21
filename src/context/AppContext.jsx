import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import {
  generateId,
  collectSKUs,
  generateSKU,
  rebuildVariationSKUs,
  calculateProductCostPerUnit,
  calculateVariationCostPerUnit,
  calculateVariationStock,
  drawFromBatches,
  restoreToBatches,
  restoreToBatchesLegacy,
  recomputeReloadDraws,
  syncOrderStockStatuses,
  resolveShipmentLine,
  calculateLandedCostPerUnit,
  calculateOrderItemUnitCostMYR,
} from '../utils/helpers'
import { STORAGE_KEYS } from '../utils/constants'
import {
  migrateShipmentsToSupplierGroups,
  migrateBatchSupplierGroupIndex,
  migrateGroupCurrency,
  migrateSalesAccountId,
  migrateSaleCostSnapshots,
  migrateAccountCurrency,
  migrateReloadWallet,
  migrateReloadFeesInclusive,
  migrateShipmentLifecycle,
  migrateExpenseCurrency,
  migrateOrderItemProductId,
  migrateClippedSKUs,
  migrateVariationSKUs,
  migrateAccountIconNames,
} from '../utils/migrations'
import { DEFAULT_ACCOUNT_ICON, DEFAULT_WALLET_ICON } from '../utils/accountIcons'
import { storageApi } from '../utils/storageApi'
import { readLegacyBrowserData } from '../utils/legacyBrowserData'

// eslint-disable-next-line react-refresh/only-export-components
export const AppContext = createContext(null)

// Existing migrations run against a temporary store. The returned dataset is
// saved through the API if a migration changed it.
function loadInitialState(input = {}) {
  const stored = Object.fromEntries(
    Object.entries(STORAGE_KEYS).map(([name, key]) => [key, JSON.stringify(input[name.toLowerCase()] ?? [])])
  )
  const memoryStorage = {
    getItem: key => stored[key],
    setItem: (key, value) => { stored[key] = value },
  }
  const load = (key, fallback = []) => {
    try {
      const raw = memoryStorage.getItem(key)
      return raw ? JSON.parse(raw) : fallback
    } catch {
      return fallback
    }
  }

  let shipments = load(STORAGE_KEYS.SHIPMENTS)
  let products = load(STORAGE_KEYS.PRODUCTS)
  let sales = load(STORAGE_KEYS.SALES)
  let expenses = load(STORAGE_KEYS.EXPENSES)
  let accounts = load(STORAGE_KEYS.ACCOUNTS)
  const suppliers = load(STORAGE_KEYS.SUPPLIERS)
  const reloads = load(STORAGE_KEYS.RELOADS)
  const orders = load(STORAGE_KEYS.ORDERS)
  // No migration and no replay needed: both legs of a transfer are derived on
  // read by calculateAccountBalance, so a stale figure cannot be stored.
  const transfers = load(STORAGE_KEYS.TRANSFERS)

  // Run migrations
  const smResult = migrateShipmentsToSupplierGroups(shipments)
  shipments = smResult.shipments
  if (smResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.SHIPMENTS, JSON.stringify(shipments))
  }

  const bmResult = migrateBatchSupplierGroupIndex(products)
  products = bmResult.products
  if (bmResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products))
  }

  // Re-derive the SKUs the old eight-character head clip mangled. Runs first:
  // it renames bases, and the variation rebuild below keys off the base it
  // finds.
  const csResult = migrateClippedSKUs(products)
  products = csResult.products
  if (csResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products))
  }

  // Spell variation SKU suffixes out in full (BLAC → BLACK). Display only, so
  // it has no ordering constraint against the migrations around it.
  const vsResult = migrateVariationSKUs(products)
  products = vsResult.products
  if (vsResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products))
  }

  const gcResult = migrateGroupCurrency(shipments)
  shipments = gcResult.shipments
  if (gcResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.SHIPMENTS, JSON.stringify(shipments))
  }

  // Add the consolidation lifecycle to pre-existing shipments (purely additive)
  const slResult = migrateShipmentLifecycle(shipments)
  shipments = slResult.shipments
  if (slResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.SHIPMENTS, JSON.stringify(shipments))
  }

  // Initialize default accounts if none exist: the bank the money comes from,
  // and the wallet the agent tops up in foreign currency.
  if (accounts.length === 0) {
    accounts = [
      { id: 'default', name: 'Bank Account', icon: DEFAULT_ACCOUNT_ICON, currency: 'MYR', isDefault: true },
      { id: 'agent-wallet', name: 'Agent Wallet', icon: DEFAULT_WALLET_ICON, currency: 'CNY', isDefault: false },
    ]
    memoryStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts))
  }

  // Backfill account currency (and seed a wallet for pre-existing users)
  const acResult = migrateAccountCurrency(accounts)
  accounts = acResult.accounts
  if (acResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts))
  }

  // Emoji account icons → Lucide icon names. Needs the currency backfill above,
  // which it reads to pick a fallback for an emoji it does not recognise.
  const aiResult = migrateAccountIconNames(accounts)
  accounts = aiResult.accounts
  if (aiResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts))
  }

  // Reloads are transfers, not expenses — point them at a wallet and drop the
  // expense records the earlier model generated. Needs accounts migrated first.
  const rwResult = migrateReloadWallet(reloads, accounts, expenses)
  expenses = rwResult.expenses
  if (rwResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.RELOADS, JSON.stringify(reloads))
    memoryStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses))
  }

  // Fold reload fees into myrPaid so it always means the whole outlay. Must run
  // before anything reads a balance or a cost rate off these records.
  const rfResult = migrateReloadFeesInclusive(reloads)
  if (rfResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.RELOADS, JSON.stringify(reloads))
  }

  // Backfill accountId on existing sales (needs accounts to exist first)
  const saResult = migrateSalesAccountId(sales, accounts)
  sales = saResult.sales

  // Backfill costPerUnit snapshots on pre-existing sales (needs migrated
  // products + shipments to compute costs)
  const scResult = migrateSaleCostSnapshots(sales, products, shipments)
  sales = scResult.sales

  if (saResult.migrated || scResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(sales))
  }

  // Mark pre-existing expenses as MYR. Must run before the wallet replay —
  // without the marker they would be read as foreign and start spending yuan.
  const ecResult = migrateExpenseCurrency(expenses)
  expenses = ecResult.expenses
  if (ecResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses))
  }

  // Bind order lines to a product id. Must run before the wallet replay, which
  // rewrites the order records this backfills into.
  const opResult = migrateOrderItemProductId(orders, products)
  if (opResult.migrated) {
    memoryStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders))
  }

  // Replay the wallet on load. Reducer writes keep it consistent during a
  // session, but a restored backup — or any imported snapshot
  // directly — can arrive stale. The replay is idempotent, so this is a no-op
  // when the data is already correct.
  const walletResult = recomputeReloadDraws(reloads, orders, expenses)
  if (
    JSON.stringify(walletResult.reloads) !== JSON.stringify(reloads) ||
    JSON.stringify(walletResult.orders) !== JSON.stringify(orders) ||
    JSON.stringify(walletResult.expenses) !== JSON.stringify(expenses)
  ) {
    memoryStorage.setItem(STORAGE_KEYS.RELOADS, JSON.stringify(walletResult.reloads))
    memoryStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(walletResult.orders))
    memoryStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(walletResult.expenses))
  }

  // Settle the stocked-in flag on load, for the same reason the wallet is
  // replayed above: reducer writes keep it right during a session, but data
  // that predates the status — or a restored backup — arrives without it. This
  // doubles as the backfill, and being a replay rather than a one-shot
  // migration it needs no marker flag to stay idempotent.
  const stockedOrders = syncOrderStockStatuses(walletResult.orders, shipments)
  if (stockedOrders !== walletResult.orders) {
    memoryStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(stockedOrders))
  }

  return {
    shipments,
    products,
    sales,
    accounts,
    suppliers,
    expenses: walletResult.expenses,
    reloads: walletResult.reloads,
    orders: stockedOrders,
    transfers,
  }
}

// ===== Reducer =====
/**
 * Replay the wallet after any change to reloads, orders or expenses. Keeps `remainingForeign`, every order's rate
 * snapshot and every foreign expense's derived MYR value consistent no matter
 * what order things were entered in.
 */
function recomputeWallet(state, nextReloads, nextOrders, nextExpenses = state.expenses) {
  const { reloads, orders, expenses } = recomputeReloadDraws(
    nextReloads,
    nextOrders,
    nextExpenses
  )
  // Editing an order's quantities can settle or unsettle it against the boxes
  // it is already in, so the stocked-in flag is replayed here too.
  const staged = syncOrderStockStatuses(orders, state.shipments)
  return { ...state, reloads, orders: staged, expenses }
}

/**
 * Shipments moving is the other half: a box arriving stocks its orders in, and
 * deleting or unpacking one walks them back. Hands the updated orders back
 * for the caller to fold into state.
 */
function syncOrderStock(orders, shipments) {
  const synced = syncOrderStockStatuses(orders, shipments)
  return synced
}

/**
 * Keep a shipment's freight expense in step with its status. Draft shipments
 * post nothing — you haven't paid the courier yet.
 */
function syncFreightExpense(expenses, shipment) {
  const index = expenses.findIndex(e => e.shipmentId === shipment.id)
  const shouldPost =
    shipment.status !== 'draft' && shipment.accountId && (parseFloat(shipment.freightMYR) || 0) > 0

  if (!shouldPost) {
    return index >= 0 ? expenses.filter(e => e.shipmentId !== shipment.id) : expenses
  }

  const expense = {
    id: index >= 0 ? expenses[index].id : generateId(),
    date: shipment.dateShipped || shipment.date,
    description: `Freight: ${shipment.description || 'Shipment'}`,
    amount: parseFloat(shipment.freightMYR) || 0,
    currency: 'MYR',
    category: 'inventory',
    accountId: shipment.accountId,
    shipmentId: shipment.id,
  }

  return index >= 0
    ? expenses.map(e => (e.shipmentId === shipment.id ? expense : e))
    : [...expenses, expense]
}

/**
 * Turn an arrived shipment's lines into stock. Each batch freezes its landed
 * cost, so no later edit to an order, reload or shipment can drift the cost of
 * inventory that has already physically landed.
 */
function materializeStock(shipment, orders, products) {
  let next = [...products]

  shipment.lines.forEach(line => {
    const received = parseFloat(line.qtyReceived ?? line.qty) || 0
    if (received <= 0) return

    const { order, item } = resolveShipmentLine(line, orders)
    if (!order || !item) return

    const batch = {
      id: generateId(),
      dateAdded: shipment.dateArrived,
      landedCostMYR: calculateLandedCostPerUnit(line, shipment, orders),
      purchasePriceMYR: calculateOrderItemUnitCostMYR(order, item),
      packSize: 1,
      quantity: received,
      remainingUnits: received,
      shipmentId: shipment.id,
      orderId: order.id,
      lineId: line.id,
    }

    const name = item.name.trim()
    // The id is the link; the name is only a fallback for order lines written
    // before lines carried one. Matching on the name first would resurrect the
    // original bug — rename a product between ordering and receiving and the
    // stock lands in a fresh duplicate instead of the product you renamed.
    const existing =
      (item.productId && next.find(p => p.id === item.productId)) ||
      next.find(p => p.name.toLowerCase().trim() === name.toLowerCase())

    if (existing && existing.hasVariations && item.variationId) {
      next = next.map(p =>
        p.id !== existing.id
          ? p
          : {
              ...p,
              variations: p.variations.map(v =>
                v.id !== item.variationId ? v : { ...v, batches: [...(v.batches || []), batch] }
              ),
            }
      )
    } else if (existing) {
      next = next.map(p =>
        p.id !== existing.id ? p : { ...p, batches: [...(p.batches || []), batch] }
      )
    } else {
      next.push({
        id: generateId(),
        name,
        sku: generateSKU(name, collectSKUs(next)),
        link: '',
        purchasePriceMYR: batch.purchasePriceMYR,
        packSize: 1,
        batches: [batch],
      })
    }
  })

  return next
}

/**
 * Strip every batch a shipment created, across products and variations.
 */
function removeBatchesForShipment(products, shipmentId) {
  return products.map(p => {
    const next = { ...p }
    if (next.batches) {
      next.batches = next.batches.filter(b => b.shipmentId !== shipmentId)
    }
    if (next.variations) {
      next.variations = next.variations.map(v => ({
        ...v,
        batches: (v.batches || []).filter(b => b.shipmentId !== shipmentId),
      }))
    }
    return next
  })
}

// ===== Sale stock movement =====
// A sale draws stock on the way in and puts back exactly what it drew on the
// way out, so add / edit / delete all stay symmetrical. Same shape the wallet
// uses for reloads.

/**
 * Deduct each item FIFO, recording the draws and snapshotting the weighted cost
 * of the exact units consumed so historical profit doesn't drift as batches
 * deplete later. `baseline` supplies the fallback cost for oversold or
 * batch-less items, and is the product list as it stood before this sale.
 */
function applySaleDraws(products, items, shipments, baseline) {
  let next = [...products]

  const costed = items.map(item => {
    let draws = []
    let costAccum = 0
    let unitsDrawn = 0

    next = next.map(p => {
      if (p.id !== item.productId) return p
      const res = drawFromBatches(p, item.variationId, item.quantity, shipments)
      draws = res.draws
      costAccum = res.costAccum
      unitsDrawn = res.unitsDrawn
      return res.product
    })

    // Oversold or batch-less product: price the uncovered units at current cost
    if (unitsDrawn < item.quantity) {
      const product = baseline.find(p => p.id === item.productId)
      let fallback = 0
      if (product) {
        if (item.variationId && product.hasVariations) {
          const variation = product.variations?.find(v => v.id === item.variationId)
          fallback = variation ? calculateVariationCostPerUnit(variation, shipments) : 0
        } else {
          fallback = calculateProductCostPerUnit(product, shipments)
        }
      }
      costAccum += (item.quantity - unitsDrawn) * fallback
    }

    return {
      ...item,
      costPerUnit: item.quantity > 0 ? costAccum / item.quantity : 0,
      batchDraws: draws,
    }
  })

  return { products: next, items: costed }
}

/**
 * Undo a sale's stock movement. Sales recorded before draws existed fall back
 * to an oldest-first restore capped at each batch's original quantity.
 */
function reverseSaleDraws(products, sale) {
  const items =
    sale.items && sale.items.length > 0
      ? sale.items
      : sale.productId
      ? [{ productId: sale.productId, quantity: sale.quantity || 0 }]
      : []

  let next = [...products]
  items.forEach(item => {
    next = next.map(p => {
      if (p.id !== item.productId) return p
      return item.batchDraws && item.batchDraws.length > 0
        ? restoreToBatches(p, item.variationId, item.batchDraws)
        : restoreToBatchesLegacy(p, item.variationId, item.quantity)
    })
  })
  return next
}

function appReducer(state, action) {
  switch (action.type) {
    // --- Suppliers ---
    case 'ADD_SUPPLIER': {
      const suppliers = [...state.suppliers, { ...action.payload, id: generateId() }]
      return { ...state, suppliers }
    }
    case 'UPDATE_SUPPLIER': {
      const suppliers = state.suppliers.map(s =>
        s.id === action.payload.id ? action.payload : s
      )
      return { ...state, suppliers }
    }
    case 'DELETE_SUPPLIER': {
      const suppliers = state.suppliers.filter(s => s.id !== action.payload)
      return { ...state, suppliers }
    }

    // --- Reloads (agent currency top-ups) ---
    // A reload is a transfer between two accounts, not an expense: MYR leaves
    // the bank and becomes foreign currency you still hold. Both sides are
    // derived by calculateAccountBalance straight off the reload record, so no
    // expense is written. Cost is only recognised as COGS when goods sell.
    case 'ADD_RELOAD': {
      const amountForeign = parseFloat(action.payload.amountForeign) || 0
      const reload = { ...action.payload, id: generateId(), amountForeign }
      return recomputeWallet(state, [...state.reloads, reload], state.orders)
    }
    case 'UPDATE_RELOAD': {
      const amountForeign = parseFloat(action.payload.amountForeign) || 0
      const updated = { ...action.payload, amountForeign }
      const reloads = state.reloads.map(r => (r.id === updated.id ? updated : r))
      return recomputeWallet(state, reloads, state.orders)
    }
    case 'DELETE_RELOAD': {
      const reloads = state.reloads.filter(r => r.id !== action.payload)
      return recomputeWallet(state, reloads, state.orders)
    }

    // --- Purchase orders ---
    // An order spends foreign currency already bought, so it posts no expense.
    // Every write replays the wallet: which top-up funded which order shifts
    // when anything is edited or back-dated.
    case 'ADD_ORDER': {
      const order = { ...action.payload, id: generateId() }
      return recomputeWallet(state, state.reloads, [...state.orders, order])
    }
    case 'UPDATE_ORDER': {
      const orders = state.orders.map(o => (o.id === action.payload.id ? action.payload : o))
      return recomputeWallet(state, state.reloads, orders)
    }
    case 'DELETE_ORDER': {
      const orders = state.orders.filter(o => o.id !== action.payload)
      return recomputeWallet(state, state.reloads, orders)
    }
    case 'SET_ORDER_STATUS': {
      // payload: { id, status }
      const orders = state.orders.map(o =>
        o.id === action.payload.id ? { ...o, status: action.payload.status } : o
      )
      // Cancelling releases the order's yuan back into the wallet
      return recomputeWallet(state, state.reloads, orders)
    }

    // --- Consolidated shipments ---
    // A shipment selects lines from orders sitting in the China warehouse.
    // Stock is created only on arrival, so nothing is sellable while it is in
    // transit. Freight is a genuine outflow (unlike a reload) so it does post
    // an expense — under `inventory`, which both Dashboard and Expenses exclude
    // from opex totals, so it capitalises into landed cost without also
    // hitting the P&L.
    case 'ADD_SHIPMENT': {
      const shipment = { ...action.payload, id: generateId() }
      const shipments = [...state.shipments, shipment]
      const expenses = syncFreightExpense(state.expenses, shipment)
      const orders = syncOrderStock(state.orders, shipments)
      return { ...state, shipments, expenses, orders }
    }
    case 'UPDATE_SHIPMENT': {
      const shipments = state.shipments.map(s =>
        s.id === action.payload.id ? action.payload : s
      )
      const expenses = syncFreightExpense(state.expenses, action.payload)
      const orders = syncOrderStock(state.orders, shipments)
      return { ...state, shipments, expenses, orders }
    }
    case 'MARK_SHIPMENT_ARRIVED': {
      // payload: { id, dateArrived, received: { [lineId]: qty } }
      const existing = state.shipments.find(s => s.id === action.payload.id)
      if (!existing || existing.status === 'arrived') return state

      const arrived = {
        ...existing,
        status: 'arrived',
        dateArrived: action.payload.dateArrived,
        lines: existing.lines.map(l => ({
          ...l,
          qtyReceived:
            action.payload.received?.[l.id] != null
              ? parseFloat(action.payload.received[l.id]) || 0
              : l.qty,
        })),
      }

      const shipments = state.shipments.map(s => (s.id === arrived.id ? arrived : s))
      const products = materializeStock(arrived, state.orders, state.products)
      const expenses = syncFreightExpense(state.expenses, arrived)
      const orders = syncOrderStock(state.orders, shipments)

      return { ...state, shipments, products, expenses, orders }
    }
    case 'DELETE_SHIPMENT': {
      const shipments = state.shipments.filter(s => s.id !== action.payload)
      const expenses = state.expenses.filter(e => e.shipmentId !== action.payload)
      // Its lines are free to consolidate again, so any order it had stocked in
      // walks back to the warehouse.
      const orders = syncOrderStock(state.orders, shipments)
      // Also drop the batches it created — leaving them orphaned would silently
      // fall back to a bare purchase price and understate cost.
      const products = removeBatchesForShipment(state.products, action.payload)
      return { ...state, shipments, expenses, products, orders }
    }

    // --- Products ---
    case 'ADD_PRODUCT': {
      let product = {
        sku: generateSKU(action.payload.name, collectSKUs(state.products)),
        ...action.payload,
        // Quick-create from an order form needs the id up front so the line can
        // bind to the product in the same tick, so honour a supplied one.
        id: action.payload.id || generateId(),
      }
      // Ensure each variation has an id
      if (product.hasVariations && product.variations) {
        product = {
          ...product,
          variations: product.variations.map(v => ({
            ...v,
            id: v.id || generateId(),
            batches: v.batches || [],
          })),
        }
      }
      const products = [...state.products, product]
      return { ...state, products }
    }
    case 'UPDATE_PRODUCT': {
      const products = state.products.map(p => {
        if (p.id !== action.payload.id) return p
        // Carrying a renamed base down to its variations belongs here, not in
        // whichever form happened to edit it: Settings' "generate missing SKUs"
        // moves a base without going near Inventory, and used to leave the
        // variations naming a parent that never existed. The Inventory form's
        // own cascade still runs — it is the only place that knows which SKUs
        // were typed — and the variations it has already renamed no longer
        // start with the old base, so this leaves them exactly as they are.
        return action.payload.sku === p.sku
          ? action.payload
          : rebuildVariationSKUs(action.payload, p.sku)
      })
      return { ...state, products }
    }
    case 'DELETE_PRODUCT': {
      const products = state.products.filter(p => p.id !== action.payload)
      // Also remove legacy single-product sales for this product
      const sales = state.sales.filter(s => s.productId !== action.payload)
      return { ...state, products, sales }
    }
    case 'RESTOCK_PRODUCT': {
      // payload: { productId, variationId?, batch }
      const products = state.products.map(p => {
        if (p.id !== action.payload.productId) return p
        if (action.payload.variationId && p.hasVariations) {
          const variations = p.variations.map(v => {
            if (v.id !== action.payload.variationId) return v
            const batches = [...(v.batches || []), { ...action.payload.batch, id: generateId() }]
            return { ...v, batches }
          })
          return { ...p, variations }
        }
        const batches = [...(p.batches || []), { ...action.payload.batch, id: generateId() }]
        return { ...p, batches }
      })
      return { ...state, products }
    }
    case 'ADD_VARIATION': {
      // payload: { productId, variation: { id, tier1Value, tier2Value, sku } }
      const products = state.products.map(p => {
        if (p.id !== action.payload.productId) return p
        const variation = { ...action.payload.variation, id: action.payload.variation.id || generateId(), batches: [] }
        return { ...p, variations: [...(p.variations || []), variation] }
      })
      return { ...state, products }
    }
    case 'DELETE_VARIATION': {
      // payload: { productId, variationId }
      const products = state.products.map(p => {
        if (p.id !== action.payload.productId) return p
        return { ...p, variations: p.variations.filter(v => v.id !== action.payload.variationId) }
      })
      return { ...state, products }
    }

    // --- Sales ---
    case 'ADD_SALE': {
      const drawn = applySaleDraws(
        state.products,
        action.payload.items || [],
        state.shipments,
        state.products
      )

      const sale = { ...action.payload, items: drawn.items, id: generateId() }
      const sales = [...state.sales, sale]
      return { ...state, sales, products: drawn.products }
    }
    case 'UPDATE_SALE': {
      // Put the original sale's units back before drawing the edited ones, so
      // changing a quantity, product or variation moves stock instead of
      // silently leaving inventory behind.
      const original = state.sales.find(s => s.id === action.payload.id)
      const restored = original ? reverseSaleDraws(state.products, original) : state.products

      const drawn = applySaleDraws(
        restored,
        action.payload.items || [],
        state.shipments,
        restored
      )

      const updated = { ...action.payload, items: drawn.items }
      const sales = state.sales.map(s => (s.id === updated.id ? updated : s))
      return { ...state, sales, products: drawn.products }
    }
    case 'DELETE_SALE': {
      const sale = state.sales.find(s => s.id === action.payload)
      if (!sale) return state

      const products = reverseSaleDraws(state.products, sale)
      const sales = state.sales.filter(s => s.id !== action.payload)
      return { ...state, sales, products }
    }

    // --- Expenses ---
    // An expense paid from a foreign wallet spends the same yuan an order
    // does, so these replay the wallet too — its MYR value is derived from
    // whichever reloads funded it, not from anything typed in.
    case 'ADD_EXPENSE': {
      const expenses = [...state.expenses, { ...action.payload, id: generateId() }]
      return recomputeWallet(state, state.reloads, state.orders, expenses)
    }
    case 'UPDATE_EXPENSE': {
      const expenses = state.expenses.map(e =>
        e.id === action.payload.id ? action.payload : e
      )
      return recomputeWallet(state, state.reloads, state.orders, expenses)
    }
    case 'DELETE_EXPENSE': {
      const expenses = state.expenses.filter(e => e.id !== action.payload)
      return recomputeWallet(state, state.reloads, state.orders, expenses)
    }

    // --- Accounts ---
    case 'ADD_ACCOUNT': {
      const accounts = [...state.accounts, { ...action.payload, id: generateId() }]
      return { ...state, accounts }
    }
    case 'UPDATE_ACCOUNT': {
      const accounts = state.accounts.map(a =>
        a.id === action.payload.id ? action.payload : a
      )
      return { ...state, accounts }
    }
    case 'DELETE_ACCOUNT': {
      const accounts = state.accounts.filter(a => a.id !== action.payload)
      return { ...state, accounts }
    }
    // An adjustment is stored as a signed delta on the account itself, and
    // calculateAccountBalance just sums them — so unlike a reload nothing needs
    // replaying here: editing or removing one moves the balance by exactly the
    // difference. BalanceAdjustModal computes the delta against the balance
    // *excluding* the record being edited, which is what keeps `Set balance to`
    // meaning the same thing on an edit as it does on a fresh adjustment.
    case 'ADJUST_BALANCE': {
      // payload: { accountId, adjustment: { date, amount, reason } }
      const accounts = state.accounts.map(a => {
        if (a.id !== action.payload.accountId) return a
        const adjustments = [
          ...(a.adjustments || []),
          { ...action.payload.adjustment, id: generateId() },
        ]
        return { ...a, adjustments }
      })
      return { ...state, accounts }
    }
    case 'UPDATE_ADJUSTMENT': {
      // payload: { accountId, adjustment: { id, date, amount, reason } }
      const { accountId, adjustment } = action.payload
      const accounts = state.accounts.map(a => {
        if (a.id !== accountId) return a
        return {
          ...a,
          adjustments: (a.adjustments || []).map(adj =>
            adj.id === adjustment.id ? { ...adj, ...adjustment } : adj
          ),
        }
      })
      return { ...state, accounts }
    }
    case 'DELETE_ADJUSTMENT': {
      // payload: { accountId, adjustmentId }
      const { accountId, adjustmentId } = action.payload
      const accounts = state.accounts.map(a => {
        if (a.id !== accountId) return a
        return {
          ...a,
          adjustments: (a.adjustments || []).filter(adj => adj.id !== adjustmentId),
        }
      })
      return { ...state, accounts }
    }

    // --- Transfers ---
    // Money moving between two MYR accounts. Nothing is replayed here: both
    // legs are derived by calculateAccountBalance straight off the record, so
    // an edit or a delete restores both balances at once. The MYR-only rule is
    // enforced by TransferModal, the sole dispatcher of these actions.
    case 'ADD_TRANSFER': {
      const transfers = [...state.transfers, { ...action.payload, id: generateId() }]
      return { ...state, transfers }
    }
    case 'UPDATE_TRANSFER': {
      const transfers = state.transfers.map(t =>
        t.id === action.payload.id ? action.payload : t
      )
      return { ...state, transfers }
    }
    case 'DELETE_TRANSFER': {
      const transfers = state.transfers.filter(t => t.id !== action.payload)
      return { ...state, transfers }
    }

    default:
      return state
  }
}

const backupRequired = ['suppliers', 'shipments', 'products', 'sales', 'expenses', 'accounts']
const datasetKeys = Object.keys(STORAGE_KEYS).map(key => key.toLowerCase())

function sameDataset(left, right) {
  return left !== null && right !== null && datasetKeys.every(key =>
    JSON.stringify(left[key]) === JSON.stringify(right[key])
  )
}

function editorOpen() {
  return Boolean(document.querySelector('.modal-overlay.active, .tab-form-view.active form')) ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
}

function prepareImport(value) {
  if (!value || backupRequired.some(key => !Array.isArray(value[key]))) {
    throw new Error('The backup is missing one or more required record lists.')
  }
  return loadInitialState(value)
}

async function fetchInitial() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await storageApi('dataset')
    if (result.dataset === null) return result
    const migrated = loadInitialState(result.dataset)
    if (sameDataset(migrated, result.dataset)) {
      return { revision: result.revision, dataset: migrated }
    }
    try {
      const saved = await storageApi('dataset', { revision: result.revision, dataset: migrated })
      return { revision: saved.revision, dataset: migrated }
    } catch (error) {
      if (error.status !== 409) throw error
    }
  }
  throw new Error('The data changed during startup. Reload to try again.')
}

function StorageSetup({ revision, onReady }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const [legacy] = useState(() => {
    try {
      return { result: readLegacyBrowserData(window.localStorage), error: '' }
    } catch (cause) {
      return { result: null, error: cause.message }
    }
  })

  async function start(dataset) {
    setBusy(true)
    setError('')
    try {
      const saved = await storageApi('dataset', { revision, dataset })
      onReady(dataset, saved.revision)
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  async function importFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      await start(prepareImport(JSON.parse(await file.text())))
    } catch (cause) {
      setError(cause.message)
    }
    event.target.value = ''
  }

  return (
    <main className="storage-gate">
      <div className="storage-gate-card">
        <h1>Set up Okanemo</h1>
        <p>This installation has no business data yet. Recover records stored by this browser, import a JSON backup, or start fresh.</p>
        {legacy.result && (
          <div className="storage-recovery">
            <strong>Old browser data found</strong>
            <p>{legacy.result.recordCount} records were found in {legacy.result.keyCount} Okanemo storage lists at <code>{window.location.origin}</code>.</p>
            <button className="btn-primary" disabled={busy} onClick={() => start(loadInitialState(legacy.result.dataset))}>
              Recover Browser Data
            </button>
          </div>
        )}
        {legacy.error && <p role="alert" className="storage-error">{legacy.error}</p>}
        {error && <p role="alert" className="storage-error">{error}</p>}
        <div className="storage-gate-actions">
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={importFile} disabled={busy} hidden />
          <button className="btn-primary" disabled={busy} onClick={() => fileRef.current.click()}>Import Backup</button>
          <button className="btn-secondary" disabled={busy} onClick={() => start(loadInitialState())}>
            Start Fresh
          </button>
        </div>
        <p className="storage-hint">Browser data is tied to the exact address. If it is not detected, reopen this app in Firefox using the same address and port you used before.</p>
      </div>
    </main>
  )
}

export function AppProvider({ children }) {
  const [stage, setStage] = useState('loading')
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [problem, setProblem] = useState(null)
  const [saving, setSaving] = useState(false)
  const stateRef = useRef(null)
  const revisionRef = useRef(0)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const problemRef = useRef(null)
  const flushRef = useRef(null)
  const bootRef = useRef(null)

  function accept(dataset, revision) {
    stateRef.current = dataset
    revisionRef.current = revision
    dirtyRef.current = false
    problemRef.current = null
    setProblem(null)
    setState(dataset)
    setStage(dataset === null ? 'setup' : 'ready')
  }

  useEffect(() => {
    bootRef.current ??= fetchInitial()
    bootRef.current.then(
      result => accept(result.dataset, result.revision),
      cause => { setError(cause.message); setStage('error') }
    )
  }, [])

  flushRef.current = async () => {
    if (savingRef.current || !dirtyRef.current || problemRef.current) return
    savingRef.current = true
    setSaving(true)
    const snapshot = stateRef.current
    const revision = revisionRef.current
    try {
      const saved = await storageApi('dataset', { revision, dataset: snapshot })
      revisionRef.current = saved.revision
      if (stateRef.current === snapshot) dirtyRef.current = false
    } catch (cause) {
      // A lost response can follow a successful commit. Check before calling it
      // a conflict, so retry never overwrites another tab's work.
      try {
        const latest = await storageApi('dataset')
        if (sameDataset(latest.dataset, snapshot)) {
          revisionRef.current = latest.revision
          if (stateRef.current === snapshot) dirtyRef.current = false
        } else {
          const issue = { type: 'conflict', message: cause.status === 409 ? cause.message : 'The server has different data. Export this unsaved copy before reloading.' }
          problemRef.current = issue
          setProblem(issue)
        }
      } catch {
        const issue = { type: 'unavailable', message: 'The storage server is unavailable. Your unsaved data is still in this tab.' }
        problemRef.current = issue
        setProblem(issue)
      }
    } finally {
      savingRef.current = false
      setSaving(false)
      if (dirtyRef.current && !problemRef.current) flushRef.current()
    }
  }

  const dispatch = useCallback(action => {
    if (problemRef.current || !stateRef.current) return false
    const next = appReducer(stateRef.current, action)
    if (next === stateRef.current) return true
    stateRef.current = next
    dirtyRef.current = true
    setState(next)
    flushRef.current()
    return true
  }, [])
  const listBackups = useCallback(() => storageApi('backups'), [])

  useEffect(() => {
    const onFocus = async () => {
      if (!stateRef.current || dirtyRef.current || savingRef.current || problemRef.current) return
      if (editorOpen()) return
      const seenRevision = revisionRef.current
      try {
        const latest = await storageApi('dataset')
        if (revisionRef.current !== seenRevision || !stateRef.current) return
        if (dirtyRef.current || savingRef.current || problemRef.current) return
        if (editorOpen()) return
        if (latest.revision !== revisionRef.current) accept(
          latest.dataset === null ? null : loadInitialState(latest.dataset), latest.revision
        )
      } catch {
        if (revisionRef.current !== seenRevision || dirtyRef.current || savingRef.current) return
        const issue = { type: 'unavailable', message: 'The storage server is unavailable. Edits are paused.' }
        problemRef.current = issue
        setProblem(issue)
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') onFocus() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    const beforeUnload = event => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  async function restoreDataset(raw) {
    if (dirtyRef.current || savingRef.current) throw new Error('Wait for the current save to finish.')
    const dataset = prepareImport(raw)
    const saved = await storageApi('restore', { revision: revisionRef.current, dataset, confirmation: 'RESTORE' })
    accept(dataset, saved.revision)
  }

  async function restoreBackup(name) {
    if (dirtyRef.current || savingRef.current) throw new Error('Wait for the current save to finish.')
    const saved = await storageApi('restore-backup', { revision: revisionRef.current, name, confirmation: 'RESTORE' })
    const migrated = loadInitialState(saved.dataset)
    if (sameDataset(migrated, saved.dataset)) {
      accept(migrated, saved.revision)
    } else {
      const updated = await storageApi('dataset', { revision: saved.revision, dataset: migrated })
      accept(migrated, updated.revision)
    }
  }

  async function clearDataset() {
    if (dirtyRef.current || savingRef.current) throw new Error('Wait for the current save to finish.')
    const result = await storageApi('clear', { revision: revisionRef.current, confirmation: 'CLEAR' })
    accept(null, result.revision)
  }

  function downloadUnsaved() {
    const blob = new Blob([JSON.stringify({ version: 3, ...stateRef.current }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `okanemo-unsaved-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function retryStorage() {
    if (dirtyRef.current) {
      problemRef.current = null
      setProblem(null)
      flushRef.current()
      return
    }
    try {
      const latest = await storageApi('dataset')
      accept(latest.dataset === null ? null : loadInitialState(latest.dataset), latest.revision)
    } catch {
      const issue = { type: 'unavailable', message: 'The storage server is still unavailable. Edits are paused.' }
      problemRef.current = issue
      setProblem(issue)
    }
  }

  if (stage === 'loading') return <div className="storage-gate">Loading business data…</div>
  if (stage === 'error') return (
    <div className="storage-gate"><div className="storage-gate-card">
      <h1>Storage unavailable</h1><p role="alert">{error}</p>
      <button className="btn-primary" onClick={() => window.location.reload()}>Retry</button>
    </div></div>
  )
  if (stage === 'setup') return <StorageSetup revision={revisionRef.current} onReady={accept} />

  return (
    <AppContext.Provider value={{ state, dispatch, restoreDataset, restoreBackup, clearDataset, listBackups }}>
      {children}
      {saving && !problem && <div className="storage-saving" role="status">Saving…</div>}
      {problem && <div className="storage-blocker"><div className="storage-gate-card" role="alertdialog" aria-modal="true">
        <h2>Changes are not saved</h2>
        <p>{problem.message}</p>
        <div className="storage-gate-actions">
          {dirtyRef.current && <button className="btn-secondary" onClick={downloadUnsaved}>Download unsaved copy</button>}
          {problem.type === 'unavailable' && <button className="btn-primary" onClick={retryStorage}>Retry connection</button>}
          <button className="btn-danger" onClick={() => {
            if (window.confirm('Reload the server data? Any unsaved changes in this tab will be lost.')) window.location.reload()
          }}>Reload server data</button>
        </div>
      </div></div>}
    </AppContext.Provider>
  )
}
