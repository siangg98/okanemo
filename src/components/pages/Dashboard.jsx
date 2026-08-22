import { useMemo, useState, useEffect } from 'react'
import {
  PiggyBank,
  Coins,
  Warehouse,
  Plane,
  Package,
  ChartPie,
} from 'lucide-react'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js'
import { useApp } from '../../hooks/useApp'
import {
  formatMYR,
  formatAmount,
  formatForeign,
  calculateChinaPipeline,
  calculateWallet,
  latestPurchasingMonth,
  calculatePurchasingMonth,
  calculateSaleTotals,
  calculateAccountBalance,
  calculateStock,
  calculateBatchCostPerUnit,
  EXPENSE_CATEGORIES,
} from '../../utils/helpers'
import AccountIcon from '../shared/AccountIcon'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement)

/** 'YYYY-MM' → 'August 2026' */
function formatMonth(month) {
  const [year, m] = month.split('-')
  const date = new Date(Number(year), Number(m) - 1, 1)
  return date.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })
}

function getMonthlyData(sales, expenses, products, shipments) {
  const now = new Date()
  const months = []
  const incomeByMonth = {}
  const expensesByMonth = {}

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-US', { month: 'short' })
    months.push({ key, label })
    incomeByMonth[key] = 0
    expensesByMonth[key] = 0
  }

  sales.forEach(sale => {
    const d = new Date(sale.date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (key in incomeByMonth) {
      const { netRevenue, totalCost } = calculateSaleTotals(sale, products, shipments)
      incomeByMonth[key] += netRevenue
      expensesByMonth[key] += totalCost
    }
  })

  expenses.forEach(e => {
    if (e.category === 'inventory') return
    const d = new Date(e.date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (key in expensesByMonth) expensesByMonth[key] += e.amount
  })

  return {
    labels: months.map(m => m.label),
    income: months.map(m => incomeByMonth[m.key]),
    expenses: months.map(m => expensesByMonth[m.key]),
  }
}

function getExpensesByCategory(expenses) {
  const totals = {}
  expenses.forEach(e => {
    if (e.category === 'inventory') return
    const cat = EXPENSE_CATEGORIES[e.category] || e.category
    totals[cat] = (totals[cat] || 0) + e.amount
  })
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1])
  return { labels: sorted.map(c => c[0]), amounts: sorted.map(c => c[1]) }
}

const CHART_COLORS = ['#D69A3B', '#7FB2E8', '#E07B3B', '#9B7FC7', '#4FAE7E', '#E2564A']

/**
 * Chart.js paints to a canvas, so it cannot resolve `var(--…)` — it needs real
 * colour values. Read the theme's tokens off the document instead of hardcoding
 * them, or the labels keep one theme's colour in both: legend text defaulted to
 * Chart.js's own #666, which is near-invisible on the dark card.
 */
function readChartTheme() {
  const s = getComputedStyle(document.body)
  const pick = (name, fallback) => s.getPropertyValue(name).trim() || fallback
  return {
    label: pick('--text-secondary', '#6B7280'),
    grid: pick('--border-color', '#E5E7EB'),
  }
}

/** Re-reads the chart tokens whenever `body.dark-mode` is toggled. */
function useChartTheme() {
  const [theme, setTheme] = useState(readChartTheme)

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readChartTheme()))
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return theme
}

function buildBarOptions(theme) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        align: 'end',
        labels: {
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 20,
          color: theme.label,
          font: { family: 'Inter', size: 12 },
        },
      },
      tooltip: {
        backgroundColor: '#1B1E22',
        padding: 12,
        cornerRadius: 4,
        callbacks: { label: ctx => `${ctx.dataset.label}: RM ${ctx.raw.toFixed(2)}` },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { family: 'Inter', size: 11 }, color: theme.label },
      },
      y: {
        beginAtZero: true,
        grid: { color: theme.grid },
        ticks: {
          font: { family: 'Inter', size: 11 },
          color: theme.label,
          callback: v => `RM ${v}`,
        },
      },
    },
  }
}

/**
 * The dashboard's signature — money's actual journey through the business,
 * Reload → Order → Shipment → Arrival → Sale, as one connected strip. Each
 * tick lights up when that stage currently holds money; `tone` overrides the
 * default gold for a stage reporting an outcome rather than capital in transit.
 */
function PipelineRail({ stages }) {
  return (
    <div className="pipeline-rail">
      {stages.map(s => {
        const Icon = s.icon
        const toneClass = s.tone ? ` tone-${s.tone}` : ''
        return (
          <div className="pipeline-stage" key={s.key}>
            <div className="pipeline-stage-head">
              <span className={`pipeline-tick${s.active ? ' active' : ''}${toneClass}`}>
                <Icon aria-hidden="true" />
              </span>
              <span className="pipeline-stage-label">{s.label}</span>
            </div>
            <div className={`pipeline-stage-value${toneClass}`}>{s.value}</div>
            {s.sub && <div className="pipeline-stage-sub">{s.sub}</div>}
          </div>
        )
      })}
    </div>
  )
}

export default function Dashboard() {
  const { state } = useApp()
  const { sales, expenses, products, shipments, accounts, reloads, orders } = state
  const chartTheme = useChartTheme()

  const pipeline = useMemo(
    () => calculateChinaPipeline(orders, shipments, reloads, accounts),
    [orders, shipments, reloads, accounts]
  )

  const purchasingMonth = useMemo(() => {
    const month = latestPurchasingMonth(reloads, orders, shipments)
    return month ? calculatePurchasingMonth(month, reloads, orders, shipments) : null
  }, [reloads, orders, shipments])

  const walletCurrency = accounts.find(a => (a.currency || 'MYR') !== 'MYR')?.currency || 'CNY'

  const wallet = useMemo(
    () => calculateWallet(reloads, walletCurrency),
    [reloads, walletCurrency]
  )

  const stats = useMemo(() => {
    // Everything ever bought, matching the lifetime totals beside it. Variation
    // products keep their batches per variation rather than on the product, and
    // pre-batch products only carry a flat quantity — both count, or the figure
    // disagrees with Total Stock about which products exist.
    let totalInvestment = 0
    products.forEach(p => {
      const batches =
        p.hasVariations && p.variations
          ? p.variations.flatMap(v => v.batches || [])
          : p.batches || []

      if (batches.length > 0) {
        batches.forEach(b => {
          totalInvestment += calculateBatchCostPerUnit(b, shipments) * b.quantity * (b.packSize || 1)
        })
      } else {
        totalInvestment += (p.purchasePriceMYR || 0) * (p.quantity || 0) * (p.packSize || 1)
      }
    })
    const totalRevenue = sales.reduce((s, sale) => s + (sale.sellingPrice || 0), 0)
    const totalFees = sales.reduce(
      (s, sale) => s + calculateSaleTotals(sale, products, shipments).totalFees,
      0
    )
    const totalProfit = sales.reduce(
      (s, sale) => s + calculateSaleTotals(sale, products, shipments).profit,
      0
    )
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
    const totalStock = products.reduce((s, p) => s + calculateStock(p, sales), 0)
    const totalExpenses = expenses.filter(e => e.category !== 'inventory').reduce((s, e) => s + e.amount, 0)
    return { totalInvestment, totalRevenue, totalFees, totalProfit, profitMargin, totalStock, totalExpenses }
  }, [sales, expenses, products, shipments])

  const monthly = useMemo(
    () => getMonthlyData(sales, expenses, products, shipments),
    [sales, expenses, products, shipments]
  )
  const catData = useMemo(() => getExpensesByCategory(expenses), [expenses])

  const barData = {
    labels: monthly.labels,
    datasets: [
      {
        label: 'Income',
        data: monthly.income,
        backgroundColor: '#4FAE7E',
        borderRadius: 3,
        barPercentage: 0.6,
        categoryPercentage: 0.7,
      },
      {
        label: 'Expenses',
        data: monthly.expenses,
        backgroundColor: '#E2564A',
        borderRadius: 3,
        barPercentage: 0.6,
        categoryPercentage: 0.7,
      },
    ],
  }

  const doughnutData = {
    labels: catData.labels,
    datasets: [
      {
        data: catData.amounts,
        backgroundColor: CHART_COLORS.slice(0, catData.labels.length),
        borderWidth: 0,
        hoverOffset: 8,
      },
    ],
  }

  const pipelineStages = useMemo(
    () => [
      {
        key: 'reload',
        label: 'Reload',
        icon: Coins,
        value: formatMYR(pipeline.walletMYR),
        sub: `${formatForeign(wallet.remainingForeign, walletCurrency)} left`,
        active: pipeline.walletMYR > 0,
      },
      {
        key: 'order',
        label: 'Order',
        icon: Warehouse,
        value: formatMYR(pipeline.atWarehouseMYR),
        active: pipeline.atWarehouseMYR > 0,
      },
      {
        key: 'shipment',
        label: 'Shipment',
        icon: Plane,
        value: formatMYR(pipeline.inTransitMYR),
        active: pipeline.inTransitMYR > 0,
      },
      {
        key: 'arrival',
        label: 'Arrival',
        icon: Package,
        value: formatMYR(stats.totalInvestment),
        sub: `${stats.totalStock} units in stock`,
        active: stats.totalInvestment > 0,
      },
      {
        key: 'sale',
        label: 'Net Profit',
        icon: PiggyBank,
        value: formatMYR(stats.totalProfit),
        sub: `Revenue ${formatMYR(stats.totalRevenue)} · Fees ${formatMYR(stats.totalFees)}`,
        active: stats.totalRevenue > 0,
        tone: stats.totalProfit >= 0 ? 'positive' : 'negative',
      },
    ],
    [pipeline, wallet, walletCurrency, stats]
  )

  const barOptions = useMemo(() => buildBarOptions(chartTheme), [chartTheme])

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
      legend: {
        position: 'right',
        labels: {
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 16,
          color: chartTheme.label,
          font: { family: 'Inter', size: 12 },
          // The legend paints each item with `legendItem.fontColor` and does not
          // fall back to `labels.color` (chart.js legend plugin, `ctx.fillStyle =
          // legendItem.fontColor`). Chart.js's own generateLabels copies the
          // colour onto every item; overriding generateLabels means doing it
          // here, or the text draws in the canvas default black.
          generateLabels: chart =>
            chart.data.labels.map((label, i) => ({
              text: `${label}: RM ${chart.data.datasets[0].data[i].toFixed(2)}`,
              fillStyle: chart.data.datasets[0].backgroundColor[i],
              strokeStyle: chart.data.datasets[0].backgroundColor[i],
              fontColor: chartTheme.label,
              pointStyle: 'circle',
              hidden: false,
              index: i,
            })),
        },
      },
      tooltip: {
        backgroundColor: '#1B1E22',
        padding: 12,
        cornerRadius: 4,
        callbacks: {
          label: ctx => {
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0)
            const pct = ((ctx.raw / total) * 100).toFixed(1)
            return `RM ${ctx.raw.toFixed(2)} (${pct}%)`
          },
        },
      },
    },
  }

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      <PipelineRail stages={pipelineStages} />

      {/* Latest month of purchasing activity */}
      {purchasingMonth && purchasingMonth.unitsLanded + purchasingMonth.foreignBought > 0 && (
        <div
          style={{
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: 16,
            display: 'flex',
            gap: 24,
            flexWrap: 'wrap',
            fontSize: 14,
            alignItems: 'baseline',
          }}
        >
          <strong style={{ color: 'var(--text-primary)' }}>{formatMonth(purchasingMonth.month)}</strong>
          <span>
            <span style={{ color: 'var(--text-secondary)' }}>Bought: </span>
            <strong>{formatForeign(purchasingMonth.foreignBought, walletCurrency)}</strong>
            <span style={{ color: 'var(--text-muted)' }}> ({formatMYR(purchasingMonth.myrPaid)})</span>
          </span>
          <span>
            <span style={{ color: 'var(--text-secondary)' }}>Spent: </span>
            <strong>{formatForeign(purchasingMonth.foreignSpent, walletCurrency)}</strong>
          </span>
          <span>
            <span style={{ color: 'var(--text-secondary)' }}>Freight: </span>
            <strong>{formatMYR(purchasingMonth.freightMYR)}</strong>
          </span>
          <span>
            <span style={{ color: 'var(--text-secondary)' }}>Landed: </span>
            <strong>{purchasingMonth.unitsLanded} units</strong>
            {purchasingMonth.unitsLanded > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}@ {formatMYR(purchasingMonth.avgLandedMYR)} avg
              </span>
            )}
          </span>
        </div>
      )}

      {/* Detail Cards */}
      <div className="dashboard-details">
        <div className="detail-card">
          <h3>Profit Margin</h3>
          <div className={`profit-margin${stats.profitMargin < 0 ? ' negative' : ''}`}>
            {stats.profitMargin.toFixed(1)}%
          </div>
        </div>
        <div className="detail-card">
          <h3>Quick Stats</h3>
          <ul className="quick-stats">
            <li>
              <span>Products</span>
              <strong>{products.length}</strong>
            </li>
            <li>
              <span>Total Stock</span>
              <strong>{stats.totalStock} units</strong>
            </li>
            <li>
              <span>Total Sales</span>
              <strong>{sales.length}</strong>
            </li>
            <li>
              <span>Total Expenses</span>
              <strong className="negative">{formatMYR(stats.totalExpenses)}</strong>
            </li>
          </ul>
        </div>
        <div className="detail-card">
          <h3>Account Balances</h3>
          <ul className="quick-stats">
            {accounts.length === 0 ? (
              <li>
                <span style={{ color: 'var(--text-muted)' }}>No accounts</span>
              </li>
            ) : (
              accounts.map(a => {
                const bal = calculateAccountBalance(a.id, accounts, expenses, sales, reloads)
                return (
                  <li key={a.id}>
                    <span>
                      <AccountIcon name={a.icon} /> {a.name}
                    </span>
                    <strong className={bal >= 0 ? 'positive' : 'negative'}>
                      {formatAmount(bal, a.currency)}
                    </strong>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      </div>

      {/* Charts */}
      <div className="charts-grid">
        <div className="chart-card">
          <div className="chart-header">
            <h3>Monthly Income vs Expenses</h3>
          </div>
          <div className="chart-container">
            <Bar data={barData} options={barOptions} />
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-header">
            <h3>Expense Breakdown</h3>
          </div>
          {catData.labels.length === 0 ? (
            <div className="chart-empty-state" style={{ height: 200 }}>
              <span><ChartPie className="icon-empty" aria-hidden="true" /></span>
              <p>No expense data yet</p>
            </div>
          ) : (
            <div className="chart-container-pie">
              <Doughnut data={doughnutData} options={doughnutOptions} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
