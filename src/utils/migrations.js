import {
  calculateProductCostPerUnit,
  collectSKUs,
  generateId,
  generateSKU,
  isDerivedSKU,
  makeVariationSKU,
  rebuildVariationSKUs,
} from './helpers.js'
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
 * The SKU generator used to clip the head to eight characters, which dropped
 * exactly the part that tells near-identical products apart: "SKTC A07 PCIe 3.0
 * Mini ITX Case" and its 4.0 sibling both proposed SKTCA07P-CASE, and only the
 * -001 collision suffix kept them apart. Re-derive with the generator that
 * keeps the digits, in two cases:
 *
 *   - the SKU is shared with another product, and
 *   - the SKU is the old generator's output plus a -NNN collision suffix,
 *     which is a machine artifact standing in for a distinction the name
 *     already made.
 *
 * Nothing else is touched. A SKU somebody chose — or one the old generator got
 * right — is already on packing slips and should not churn, which is why the
 * suffix case insists the stem match what the old rule would have produced
 * rather than trusting a trailing -001 on its own: "TSHIRT-001" typed by hand
 * looks identical and is nobody's artifact.
 *
 * Every member of a colliding group is re-derived, not just the later ones:
 * renaming one side leaves an asymmetric pair where the other still carries the
 * clipped name.
 *
 * Must run before migrateVariationSKUs, whose rebuild is keyed on a variation
 * SKU still starting with its product's; a base renamed here breaks that
 * prefix, so the variations are rebuilt in step — and that rebuild is reported
 * like any other change, since it is the last chance to write it. Only the
 * variations that hung off the old base are carried down, the same line
 * migrateVariationSKUs draws: a SKU typed in from outside never carried the
 * prefix and is not this product's to rename. Those strays are flagged
 * `skuCustom` instead, so the Inventory form stops seeding a blank field for
 * them and overwriting them on the next base edit; clearing that field clears
 * the flag and hands the SKU back to the generator.
 * Returns { products, migrated }.
 */
export function migrateClippedSKUs(products) {
  let migrated = false
  if (!Array.isArray(products)) return { products, migrated }

  // The pre-fix head rule: every word run together, then clipped to eight.
  const legacyBase = (name = '') => {
    const clean = s => s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8)
    const words = name.trim().split(/\s+/).filter(Boolean)
    if (words.length > 1) {
      const head = clean(words.slice(0, -1).join(''))
      const tail = clean(words[words.length - 1])
      return head && tail ? `${head}-${tail}` : head || tail
    }
    return clean(words[0] || '')
  }

  const counts = new Map()
  products.forEach(p => {
    if (p.sku) counts.set(p.sku, (counts.get(p.sku) || 0) + 1)
  })

  const stale = p => {
    if (!p.sku) return false
    if (counts.get(p.sku) > 1) return true
    const suffixed = p.sku.match(/^(.*)-\d{3}$/)
    return !!suffixed && suffixed[1] === legacyBase(p.name || '')
  }

  const staleIds = new Set(products.filter(stale).map(p => p.id))
  if (staleIds.size === 0) return { products, migrated }

  const taken = collectSKUs(products.filter(p => !staleIds.has(p.id)))

  const next = products.map(p => {
    if (!staleIds.has(p.id)) return p
    const sku = generateSKU(p.name || '', taken)
    taken.push(sku)
    // A variation whose SKU never hung off this base is not this product's to
    // rename, so the rebuild below leaves it alone — and left unflagged, the
    // Inventory form seeds a blank SKU field for it (it only pre-fills
    // overridden ones) and overwrites it the next time the base is edited. Flag
    // it instead: `skuCustom` is what a variation earns by carrying a SKU the
    // base would not have produced, and it is the same flag the form reads to
    // pre-fill the field. The test is the rebuild's own, so the two cannot
    // disagree about which variations are the product's.
    const owned = {
      ...p,
      sku,
      variations: (p.variations || []).map(v =>
        v.sku && !v.skuCustom && !isDerivedSKU(v.sku, p.sku) ? { ...v, skuCustom: true } : v
      ),
    }
    const flagged = (p.variations || []).some((v, i) => owned.variations[i] !== v)
    const rebuilt = rebuildVariationSKUs(owned, p.sku)
    const variations = rebuilt.variations || []
    variations.forEach(v => v.sku && taken.push(v.sku))
    // The rebuild counts as a change on its own, even when the head re-derives
    // to the string it already had: a colliding pair whose -001 turns out to be
    // its own name, or the suffix case re-emitting what it started with, still
    // moves the variations hanging off it. The flag counts too — it is what
    // stops the form overwriting the SKU. Report both, because the caller writes
    // only what it is told about — an unflagged change stays in memory, and
    // migrateVariationSKUs then finds nothing to do because it reads the
    // already-rebuilt array. (By position: the rebuild maps variations 1:1.)
    const moved =
      flagged || sku !== p.sku || variations.some((v, i) => v.sku !== p.variations?.[i]?.sku)
    if (moved) migrated = true
    return rebuilt
  })

  return { products: next, migrated }
}

/**
 * Variation SKUs used to clip each tier value to four characters and run the
 * two tiers together, so Black and White both read as BLAC and WHIT, and a
 * Black/Small pair collapsed to BLACS. The suffix is the part a person scans to
 * tell two rows apart, so it is now spelled out in full and hyphenated between
 * tiers. Rebuild the ones already written.
 *
 * A variation flagged `skuCustom` was typed by hand and is never touched.
 * Beyond that, only variations whose SKU still starts with their product's is
 * rebuilt: that is the shape this generator produces, so anything else came
 * from outside the app and is left alone. Renaming is safe because order lines,
 * batches and sales all reference a variation by id — the SKU is display only.
 * Returns { products, migrated }.
 */
export function migrateVariationSKUs(products) {
  let migrated = false
  if (!Array.isArray(products)) return { products, migrated }

  products.forEach(product => {
    if (!product.sku || !Array.isArray(product.variations)) return
    product.variations.forEach(variation => {
      if (variation.skuCustom) return
      if (!isDerivedSKU(variation.sku, product.sku)) return
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
