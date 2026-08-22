import { createContext, useReducer } from 'react'
import {
  generateId,
  generateSKU,
  calculateProductCostPerUnit,
  calculateVariationCostPerUnit,
  calculateVariationStock,
  drawFromBatches,
  restoreToBatches,
  restoreToBatchesLegacy,
  recomputeReloadDraws,
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
  migrateVariationSKUs,
  migrateAccountIconNames,
} from '../utils/migrations'
import { DEFAULT_ACCOUNT_ICON, DEFAULT_WALLET_ICON } from '../utils/accountIcons'

// eslint-disable-next-line react-refresh/only-export-components
export const AppContext = createContext(null)

// ===== Load from localStorage with migrations =====
function loadInitialState() {
  const load = (key, fallback = []) => {
    try {
      const raw = localStorage.getItem(key)
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

  // Run migrations
  const smResult = migrateShipmentsToSupplierGroups(shipments)
  shipments = smResult.shipments
  if (smResult.migrated) {
    localStorage.setItem(STORAGE_KEYS.SHIPMENTS, JSON.stringify(shipments))
  }

  const bmResult = migrateBatchSupplierGroupIndex(products)
  products = bmResult.products
  if (bmResult.migrated) {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products))
  }

  // Spell variation SKU suffixes out in full (BLAC → BLACK). Display only, so
  // it has no ordering constraint against the migrations around it.
  const vsResult = migrateVariationSKUs(products)
  products = vsResult.products
  if (vsResult.migrated) {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products))
  }

  const gcResult = migrateGroupCurrency(shipments)
  shipments = gcResult.shipments
  if (gcResult.migrated) {
    localStorage.setItem(STORAGE_KEYS.SHIPMENTS, JSON.stringify(shipments))
  }

  // Add the consolidation lifecycle to pre-existing shipments (purely additive)
  const slResult = migrateShipmentLifecycle(shipments)
  shipments = slResult.shipments
  if (slResult.migrated) {
    localStorage.setItem(STORAGE_KEYS.SHIPMENTS, JSON.stringify(shipments))
  }

  // Initialize default accounts if none exist: the bank the money comes from,
  // and the wallet the agent tops up in foreign currency.
  if (accounts.length === 0) {
    accounts = [
      { id: 'default', name: 'Bank Account', icon: DEFAULT_ACCOUNT_ICON, currency: 'MYR', isDefault: true },
      { id: 'agent-wallet', name: 'Agent Wallet', icon: DEFAULT_WALLET_ICON, currency: 'CNY', isDefault: false },
    ]
    localStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts))
  }

  // Backfill account currency (and seed a wallet for pre-existing users)
  const acResult = migrateAccountCurrency(accounts)
  accounts = acResult.accounts
  if (acResult.migrated) {
    localStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts))
  }

  // Emoji account icons → Lucide icon names. Needs the currency backfill above,
  // which it reads to pick a fallback for an emoji it does not recognise.
  const aiResult = migrateAccountIconNames(accounts)
  accounts = aiResult.accounts
  if (aiResult.migrated) {
    localStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts))
  }

  // Reloads are transfers, not expenses — point them at a wallet and drop the
  // expense records the earlier model generated. Needs accounts migrated first.
  const rwResult = migrateReloadWallet(reloads, accounts, expenses)
  expenses = rwResult.expenses
  if (rwResult.migrated) {
    localStorage.setItem(STORAGE_KEYS.RELOADS, JSON.stringify(reloads))
    localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses))
  }

  // Fold reload fees into myrPaid so it always means the whole outlay. Must run
  // before anything reads a balance or a cost rate off these records.
  const rfResult = migrateReloadFeesInclusive(reloads)
  if (rfResult.migrated) {
    localStorage.setItem(STORAGE_KEYS.RELOADS, JSON.stringify(reloads))
  }

  // Backfill accountId on existing sales (needs accounts to exist first)
  const saResult = migrateSalesAccountId(sales, accounts)
  sales = saResult.sales

  // Backfill costPerUnit snapshots on pre-existing sales (needs migrated
  // products + shipments to compute costs)
  const scResult = migrateSaleCostSnapshots(sales, products, shipments)
  sales = scResult.sales

  if (saResult.migrated || scResult.migrated) {
    localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(sales))
  }

  // Mark pre-existing expenses as MYR. Must run before the wallet replay —
  // without the marker they would be read as foreign and start spending yuan.
  const ecResult = migrateExpenseCurrency(expenses)
  expenses = ecResult.expenses
  if (ecResult.migrated) {
    localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses))
  }

  // Bind order lines to a product id. Must run before the wallet replay, which
  // rewrites the order records this backfills into.
  const opResult = migrateOrderItemProductId(orders, products)
  if (opResult.migrated) {
    localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders))
  }

  // Replay the wallet on load. Reducer writes keep it consistent during a
  // session, but a restored backup — or anything that wrote localStorage
  // directly — can arrive stale. The replay is idempotent, so this is a no-op
  // when the data is already correct.
  const walletResult = recomputeReloadDraws(reloads, orders, expenses)
  if (
    JSON.stringify(walletResult.reloads) !== JSON.stringify(reloads) ||
    JSON.stringify(walletResult.orders) !== JSON.stringify(orders) ||
    JSON.stringify(walletResult.expenses) !== JSON.stringify(expenses)
  ) {
    localStorage.setItem(STORAGE_KEYS.RELOADS, JSON.stringify(walletResult.reloads))
    localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(walletResult.orders))
    localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(walletResult.expenses))
  }

  return {
    shipments,
    products,
    sales,
    accounts,
    suppliers,
    expenses: walletResult.expenses,
    reloads: walletResult.reloads,
    orders: walletResult.orders,
  }
}

// ===== Reducer =====
function persist(key, data) {
  localStorage.setItem(key, JSON.stringify(data))
}

/**
 * Replay the wallet after any change to reloads, orders or expenses, then
 * persist all three slices. Keeps `remainingForeign`, every order's rate
 * snapshot and every foreign expense's derived MYR value consistent no matter
 * what order things were entered in.
 */
function persistWallet(state, nextReloads, nextOrders, nextExpenses = state.expenses) {
  const { reloads, orders, expenses } = recomputeReloadDraws(
    nextReloads,
    nextOrders,
    nextExpenses
  )
  persist(STORAGE_KEYS.RELOADS, reloads)
  persist(STORAGE_KEYS.ORDERS, orders)
  persist(STORAGE_KEYS.EXPENSES, expenses)
  return { ...state, reloads, orders, expenses }
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
        sku: generateSKU(name, next.map(p => p.sku)),
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
      persist(STORAGE_KEYS.SUPPLIERS, suppliers)
      return { ...state, suppliers }
    }
    case 'UPDATE_SUPPLIER': {
      const suppliers = state.suppliers.map(s =>
        s.id === action.payload.id ? action.payload : s
      )
      persist(STORAGE_KEYS.SUPPLIERS, suppliers)
      return { ...state, suppliers }
    }
    case 'DELETE_SUPPLIER': {
      const suppliers = state.suppliers.filter(s => s.id !== action.payload)
      persist(STORAGE_KEYS.SUPPLIERS, suppliers)
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
      return persistWallet(state, [...state.reloads, reload], state.orders)
    }
    case 'UPDATE_RELOAD': {
      const amountForeign = parseFloat(action.payload.amountForeign) || 0
      const updated = { ...action.payload, amountForeign }
      const reloads = state.reloads.map(r => (r.id === updated.id ? updated : r))
      return persistWallet(state, reloads, state.orders)
    }
    case 'DELETE_RELOAD': {
      const reloads = state.reloads.filter(r => r.id !== action.payload)
      return persistWallet(state, reloads, state.orders)
    }

    // --- Purchase orders ---
    // An order spends foreign currency already bought, so it posts no expense.
    // Every write replays the wallet: which top-up funded which order shifts
    // when anything is edited or back-dated.
    case 'ADD_ORDER': {
      const order = { ...action.payload, id: generateId() }
      return persistWallet(state, state.reloads, [...state.orders, order])
    }
    case 'UPDATE_ORDER': {
      const orders = state.orders.map(o => (o.id === action.payload.id ? action.payload : o))
      return persistWallet(state, state.reloads, orders)
    }
    case 'DELETE_ORDER': {
      const orders = state.orders.filter(o => o.id !== action.payload)
      return persistWallet(state, state.reloads, orders)
    }
    case 'SET_ORDER_STATUS': {
      // payload: { id, status }
      const orders = state.orders.map(o =>
        o.id === action.payload.id ? { ...o, status: action.payload.status } : o
      )
      // Cancelling releases the order's yuan back into the wallet
      return persistWallet(state, state.reloads, orders)
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
      persist(STORAGE_KEYS.SHIPMENTS, shipments)
      persist(STORAGE_KEYS.EXPENSES, expenses)
      return { ...state, shipments, expenses }
    }
    case 'UPDATE_SHIPMENT': {
      const shipments = state.shipments.map(s =>
        s.id === action.payload.id ? action.payload : s
      )
      const expenses = syncFreightExpense(state.expenses, action.payload)
      persist(STORAGE_KEYS.SHIPMENTS, shipments)
      persist(STORAGE_KEYS.EXPENSES, expenses)
      return { ...state, shipments, expenses }
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

      persist(STORAGE_KEYS.SHIPMENTS, shipments)
      persist(STORAGE_KEYS.PRODUCTS, products)
      persist(STORAGE_KEYS.EXPENSES, expenses)
      return { ...state, shipments, products, expenses }
    }
    case 'DELETE_SHIPMENT': {
      const shipments = state.shipments.filter(s => s.id !== action.payload)
      const expenses = state.expenses.filter(e => e.shipmentId !== action.payload)
      // Also drop the batches it created — leaving them orphaned would silently
      // fall back to a bare purchase price and understate cost.
      const products = removeBatchesForShipment(state.products, action.payload)
      persist(STORAGE_KEYS.SHIPMENTS, shipments)
      persist(STORAGE_KEYS.EXPENSES, expenses)
      persist(STORAGE_KEYS.PRODUCTS, products)
      return { ...state, shipments, expenses, products }
    }

    // --- Products ---
    case 'ADD_PRODUCT': {
      let product = {
        sku: generateSKU(action.payload.name, state.products.map(p => p.sku)),
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
      persist(STORAGE_KEYS.PRODUCTS, products)
      return { ...state, products }
    }
    case 'UPDATE_PRODUCT': {
      const products = state.products.map(p =>
        p.id === action.payload.id ? action.payload : p
      )
      persist(STORAGE_KEYS.PRODUCTS, products)
      return { ...state, products }
    }
    case 'DELETE_PRODUCT': {
      const products = state.products.filter(p => p.id !== action.payload)
      // Also remove legacy single-product sales for this product
      const sales = state.sales.filter(s => s.productId !== action.payload)
      persist(STORAGE_KEYS.PRODUCTS, products)
      persist(STORAGE_KEYS.SALES, sales)
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
      persist(STORAGE_KEYS.PRODUCTS, products)
      return { ...state, products }
    }
    case 'ADD_VARIATION': {
      // payload: { productId, variation: { id, tier1Value, tier2Value, sku } }
      const products = state.products.map(p => {
        if (p.id !== action.payload.productId) return p
        const variation = { ...action.payload.variation, id: action.payload.variation.id || generateId(), batches: [] }
        return { ...p, variations: [...(p.variations || []), variation] }
      })
      persist(STORAGE_KEYS.PRODUCTS, products)
      return { ...state, products }
    }
    case 'DELETE_VARIATION': {
      // payload: { productId, variationId }
      const products = state.products.map(p => {
        if (p.id !== action.payload.productId) return p
        return { ...p, variations: p.variations.filter(v => v.id !== action.payload.variationId) }
      })
      persist(STORAGE_KEYS.PRODUCTS, products)
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
      persist(STORAGE_KEYS.SALES, sales)
      persist(STORAGE_KEYS.PRODUCTS, drawn.products)
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
      persist(STORAGE_KEYS.SALES, sales)
      persist(STORAGE_KEYS.PRODUCTS, drawn.products)
      return { ...state, sales, products: drawn.products }
    }
    case 'DELETE_SALE': {
      const sale = state.sales.find(s => s.id === action.payload)
      if (!sale) return state

      const products = reverseSaleDraws(state.products, sale)
      const sales = state.sales.filter(s => s.id !== action.payload)
      persist(STORAGE_KEYS.SALES, sales)
      persist(STORAGE_KEYS.PRODUCTS, products)
      return { ...state, sales, products }
    }

    // --- Expenses ---
    // An expense paid from a foreign wallet spends the same yuan an order
    // does, so these replay the wallet too — its MYR value is derived from
    // whichever reloads funded it, not from anything typed in.
    case 'ADD_EXPENSE': {
      const expenses = [...state.expenses, { ...action.payload, id: generateId() }]
      return persistWallet(state, state.reloads, state.orders, expenses)
    }
    case 'UPDATE_EXPENSE': {
      const expenses = state.expenses.map(e =>
        e.id === action.payload.id ? action.payload : e
      )
      return persistWallet(state, state.reloads, state.orders, expenses)
    }
    case 'DELETE_EXPENSE': {
      const expenses = state.expenses.filter(e => e.id !== action.payload)
      return persistWallet(state, state.reloads, state.orders, expenses)
    }

    // --- Accounts ---
    case 'ADD_ACCOUNT': {
      const accounts = [...state.accounts, { ...action.payload, id: generateId() }]
      persist(STORAGE_KEYS.ACCOUNTS, accounts)
      return { ...state, accounts }
    }
    case 'UPDATE_ACCOUNT': {
      const accounts = state.accounts.map(a =>
        a.id === action.payload.id ? action.payload : a
      )
      persist(STORAGE_KEYS.ACCOUNTS, accounts)
      return { ...state, accounts }
    }
    case 'DELETE_ACCOUNT': {
      const accounts = state.accounts.filter(a => a.id !== action.payload)
      persist(STORAGE_KEYS.ACCOUNTS, accounts)
      return { ...state, accounts }
    }
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
      persist(STORAGE_KEYS.ACCOUNTS, accounts)
      return { ...state, accounts }
    }

    default:
      return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, null, loadInitialState)

  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
}
