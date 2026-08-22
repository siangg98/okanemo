export const STORAGE_KEYS = {
  SHIPMENTS: 'okanemo_shipments',
  PRODUCTS: 'okanemo_products',
  SALES: 'okanemo_sales',
  EXPENSES: 'okanemo_expenses',
  ACCOUNTS: 'okanemo_accounts',
  SUPPLIERS: 'okanemo_suppliers',
  RELOADS: 'okanemo_reloads',
  ORDERS: 'okanemo_orders',
}

// Purchase order lifecycle. Stock is only created when a shipment carrying the
// order's items arrives — see Shipments.
export const ORDER_STATUS = {
  ordered: 'Ordered',
  at_warehouse: 'At Warehouse',
  cancelled: 'Cancelled',
}

// Consolidated shipment lifecycle. Stock is created on the move to `arrived`.
export const SHIPMENT_STATUS = {
  draft: 'Draft',
  shipped: 'In Transit',
  arrived: 'Arrived',
}

// Currencies selectable on reloads and purchase orders.
export const CURRENCIES = ['MYR', 'CNY', 'USD', 'JPY', 'SGD', 'EUR', 'GBP', 'THB']

// Currency the agent tops up in — the default for new reloads.
export const DEFAULT_FOREIGN_CURRENCY = 'CNY'
