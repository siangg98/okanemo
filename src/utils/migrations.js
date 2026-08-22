import { calculateProductCostPerUnit, generateId, makeVariationSKU } from './helpers.js'
import {
  LEGACY_EMOJI_ICONS,
  DEFAULT_ACCOUNT_ICON,
  DEFAULT_WALLET_ICON,
  isAccountIconName,
} from './accountIcons.js'

/**
 * Migrate shipments from old flat format to the multi-supplier-group format.
 * Returns updated shipments array (mutates in place and returns it).
 */
export function migrateShipmentsToSupplierGroups(shipments) {
  let migrated = false

  shipments.forEach((s, index) => {
    if (s.supplierGroups) return
    // Consolidation shipments have `lines`, not supplier groups. This rebuilds
    // the record from old-format fields only, so it must never touch them —
    // doing so would wipe their lines, freight and dates.
    if (Array.isArray(s.lines)) return

    migrated = true
    shipments[index] = {
      id: s.id,
      date: s.date,
      description: s.description,
      shippingCost: s.shippingCost,
      totalItems: s.totalItems,
      totalValueMYR: s.totalValueCNY || 0,
      costPerUnit: s.costPerUnit,
      supplierGroups: [
        {
          supplierId: s.supplierId || '',
          sellerDiscountMYR: s.sellerDiscountCNY || 0,
          domesticShippingMYR: s.domesticShippingCNY || 0,
          items: s.items || [],
          totalValueMYR: s.totalValueCNY || 0,
        },
      ],
    }
  })

  return { shipments, migrated }
}

/**
 * Ensure every product batch has a supplierGroupIndex field.
 * Returns { products, migrated }.
 */
export function migrateBatchSupplierGroupIndex(products) {
  let migrated = false

  products.forEach(product => {
    if (!product.batches) return
    product.batches.forEach(batch => {
      if (batch.supplierGroupIndex !== undefined) return
      batch.supplierGroupIndex = 0
      migrated = true
    })
  })

  return { products, migrated }
}

/**
 * Backfill accountId on sales created before sale income posted to accounts.
 * Existing sales are assigned to the default account so their net revenue is
 * reflected in balances. Runs after the default account is guaranteed to exist.
 * Returns { sales, migrated }.
 */
export function migrateSalesAccountId(sales, accounts) {
  let migrated = false
  const defaultAccount = accounts.find(a => a.isDefault) || accounts[0]
  if (!defaultAccount) return { sales, migrated }

  sales.forEach(sale => {
    if (sale.accountId !== undefined) return
    sale.accountId = defaultAccount.id
    migrated = true
  })

  return { sales, migrated }
}

/**
 * Backfill costPerUnit snapshots on sales recorded before cost was captured
 * at sale time. The original batches the sale consumed are unknown, so the
 * current FIFO cost is the best available approximation — but once set, the
 * value is frozen and won't drift as batches deplete. New sales snapshot the
 * exact cost in ADD_SALE. Returns { sales, migrated }.
 */
export function migrateSaleCostSnapshots(sales, products, shipments) {
  let migrated = false

  sales.forEach(sale => {
    if (sale.items && sale.items.length > 0) {
      sale.items.forEach(item => {
        if (item.costPerUnit != null) return
        const product = products.find(p => p.id === item.productId)
        item.costPerUnit = product ? calculateProductCostPerUnit(product, shipments) : 0
        migrated = true
      })
    } else if (sale.productId && sale.costPerUnit == null) {
      // Legacy single-product format
      const product = products.find(p => p.id === sale.productId)
      sale.costPerUnit = product ? calculateProductCostPerUnit(product, shipments) : 0
      migrated = true
    }
  })

  return { sales, migrated }
}

/**
 * Add the consolidation lifecycle to shipments recorded before it existed.
 * Purely additive: `supplierGroups`, `shippingCost` and `date` stay untouched,
 * so their batches keep costing through the original path. Old shipments are
 * treated as already arrived, because they were.
 * Returns { shipments, migrated }.
 */
export function migrateShipmentLifecycle(shipments) {
  let migrated = false

  shipments.forEach(shipment => {
    if (shipment.status !== undefined) return
    shipment.status = 'arrived'
    shipment.dateArrived = shipment.date
    shipment.dateShipped = shipment.date
    shipment.freightMYR = shipment.shippingCost || 0
    shipment.lines = []
    migrated = true
  })

  return { shipments, migrated }
}

/**
 * Give every account a currency — everything that predates multi-currency
 * accounts is MYR. On the first run only, seed a foreign wallet for the agent
 * to reload into. The seed is guarded by the same flag as the backfill, so
 * deleting the wallet later does not resurrect it on the next load.
 * Returns { accounts, migrated }.
 */
export function migrateAccountCurrency(accounts) {
  let migrated = false

  accounts.forEach(account => {
    if (account.currency !== undefined) return
    account.currency = 'MYR'
    migrated = true
  })

  if (migrated && !accounts.some(a => a.currency !== 'MYR')) {
    accounts.push({
      id: generateId(),
      name: 'Agent Wallet',
      icon: DEFAULT_WALLET_ICON,
      currency: 'CNY',
      isDefault: false,
      adjustments: [],
    })
  }

  return { accounts, migrated }
}

/**
 * Reloads were first modelled as an expense against the paying account. That
 * misrepresents them: converting MYR to yuan does not consume the money, it
 * moves it — the cost only becomes an expense as COGS when the goods sell.
 *
 * Point each reload at the wallet account that received the currency and drop
 * the expense it generated. Must run after migrateAccountCurrency so a wallet
 * exists to point at. Returns { reloads, expenses, migrated }.
 */
export function migrateReloadWallet(reloads, accounts, expenses) {
  let migrated = false
  if (!Array.isArray(reloads) || reloads.length === 0) {
    return { reloads, expenses, migrated }
  }

  reloads.forEach(reload => {
    if (reload.walletAccountId !== undefined) return
    const wallet = accounts.find(a => (a.currency || 'MYR') === reload.currency)
    reload.walletAccountId = wallet ? wallet.id : null
    migrated = true
  })

  // Only app-generated reload expenses carry reloadId, so this never touches
  // anything the user typed by hand.
  const cleaned = migrated ? expenses.filter(e => !e.reloadId) : expenses

  return { reloads, expenses: cleaned, migrated }
}

/**
 * `myrPaid` used to mean one of two things depending on a `feesIncluded` flag:
 * either the amount converted, with fees charged on top, or the whole outlay.
 * One field with two meanings meant every reader had to route through a helper
 * to learn which — and the reload list, which did not, showed two identical
 * outlays as different numbers.
 *
 * Normalise on the outlay: `myrPaid` is now always the total that left the
 * bank, so fold the fees into the additive records.
 *
 * `feesIncluded: true` stays on as the marker that a record is normalised.
 * Without it a second pass cannot tell a folded record from a legacy one and
 * would fold the fees in twice, so new reloads are written carrying it too.
 * Returns { reloads, migrated }.
 */
export function migrateReloadFeesInclusive(reloads) {
  let migrated = false
  if (!Array.isArray(reloads)) return { reloads, migrated }

  reloads.forEach(reload => {
    if (reload.feesIncluded === true) return // already the whole outlay
    const fees = (parseFloat(reload.agentFeeMYR) || 0) + (parseFloat(reload.bankFeeMYR) || 0)
    // The old code summed these on every read and threw the result away; this
    // one is kept, so round the binary-float tail off before it lands in
    // storage and turns up in a backup export as 2000.3999999999999.
    reload.myrPaid = Math.round(((parseFloat(reload.myrPaid) || 0) + fees) * 100) / 100
    reload.feesIncluded = true
    migrated = true
  })

  return { reloads, migrated }
}

/**
 * Stamp `currency` on expenses written before foreign-currency spending
 * existed. Everything recorded then was paid in MYR, and a MYR expense never
 * draws on a wallet — so this marker is what keeps old records out of the
 * reload replay rather than having them silently spend yuan.
 * Returns { expenses, migrated }.
 */
export function migrateExpenseCurrency(expenses) {
  let migrated = false
  if (!Array.isArray(expenses)) return { expenses, migrated }

  expenses.forEach(expense => {
    if (expense.currency) return
    expense.currency = 'MYR'
    migrated = true
  })

  return { expenses, migrated }
}

/**
 * Variation SKUs used to clip each tier value to four characters and run the
 * two tiers together, so Black and White both read as BLAC and WHIT, and a
 * Black/Small pair collapsed to BLACS. The suffix is the part a person scans to
 * tell two rows apart, so it is now spelled out in full and hyphenated between
 * tiers. Rebuild the ones already written.
 *
 * Only variations whose SKU still starts with their product's SKU are touched:
 * that is the shape this generator produces, and nothing in the UI lets a
 * variation SKU be typed by hand, so anything else came from outside the app
 * and is left alone. Renaming is safe because order lines, batches and sales
 * all reference a variation by id — the SKU is display only.
 * Returns { products, migrated }.
 */
export function migrateVariationSKUs(products) {
  let migrated = false
  if (!Array.isArray(products)) return { products, migrated }

  products.forEach(product => {
    if (!product.sku || !Array.isArray(product.variations)) return
    product.variations.forEach(variation => {
      if (!variation.sku || !variation.sku.startsWith(`${product.sku}-`)) return
      const rebuilt = makeVariationSKU(product.sku, variation.tier1Value, variation.tier2Value)
      if (rebuilt === variation.sku) return
      variation.sku = rebuilt
      migrated = true
    })
  })

  return { products, migrated }
}

/**
 * Order lines named their product as free text, and arrival materialised stock
 * by matching that string against the product list. The string was the only
 * link, so renaming a product — or mistyping it once — silently created a
 * second product and split its stock and cost history in two.
 *
 * Bind each line to a product id instead. Existing lines are matched on the
 * name they already carry, which is exactly the match arrival would have made,
 * so nothing moves: this only freezes the link before a later rename can break
 * it. A line naming a product that no longer exists keeps a null id and still
 * falls back to the name at arrival, so old orders stay materialisable.
 * Returns { orders, migrated }.
 */
export function migrateOrderItemProductId(orders, products) {
  let migrated = false
  if (!Array.isArray(orders)) return { orders, migrated }

  orders.forEach(order => {
    if (!Array.isArray(order.items)) return
    order.items.forEach(item => {
      if (item.productId !== undefined) return
      const name = (item.name || '').toLowerCase().trim()
      const match = products.find(p => (p.name || '').toLowerCase().trim() === name)
      item.productId = match ? match.id : null
      migrated = true
    })
  })

  return { orders, migrated }
}

/**
 * Backfill multi-currency fields on supplier groups that were created before
 * the currency feature was added. All legacy records are MYR, so:
 *   currency = 'MYR', exchangeRate = 1
 *   sellerDiscountAmount/Currency ← sellerDiscountMYR
 *   domesticShippingAmount/Currency ← domesticShippingMYR
 *   items: unitPrice ← priceMYR, currency ← 'MYR'
 *   totalValueOriginal ← totalValueMYR
 * Returns { shipments, migrated }.
 */
export function migrateGroupCurrency(shipments) {
  let migrated = false

  shipments.forEach(shipment => {
    if (!shipment.supplierGroups) return
    shipment.supplierGroups.forEach(group => {
      if (group.currency !== undefined) return // already migrated

      migrated = true
      group.currency = 'MYR'
      group.exchangeRate = 1
      group.amountPaidMYR = null

      group.sellerDiscountAmount = group.sellerDiscountMYR || 0
      group.sellerDiscountCurrency = 'MYR'

      group.domesticShippingAmount = group.domesticShippingMYR || 0
      group.domesticShippingCurrency = 'MYR'

      group.totalValueOriginal = group.totalValueMYR || 0

      if (Array.isArray(group.items)) {
        group.items.forEach(item => {
          if (item.unitPrice === undefined) {
            item.unitPrice = item.priceMYR || 0
            item.currency = 'MYR'
          }
        })
      }
    })
  })

  return { shipments, migrated }
}

/**
 * Accounts used to store their icon as a hand-typed emoji. Swap each one for a
 * name from the Lucide registry, so the icon can inherit the theme's colour and
 * scale with the layout the way every other icon in the app does.
 *
 * No `migrated` flag is needed to stay idempotent: a name already in the
 * registry is left alone, and the emoji it replaced can never come back. An
 * emoji outside `LEGACY_EMOJI_ICONS` — anything hand-typed — falls back on what
 * the account *is*, since a foreign account is a wallet and MYR is a bank.
 *
 * Returns { accounts, migrated }.
 */
export function migrateAccountIconNames(accounts) {
  let migrated = false

  accounts.forEach(account => {
    if (isAccountIconName(account.icon)) return

    account.icon =
      LEGACY_EMOJI_ICONS[account.icon] ||
      (account.currency && account.currency !== 'MYR'
        ? DEFAULT_WALLET_ICON
        : DEFAULT_ACCOUNT_ICON)
    migrated = true
  })

  return { accounts, migrated }
}
