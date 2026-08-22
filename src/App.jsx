import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import Dashboard from './components/pages/Dashboard'
import Sales from './components/pages/Sales'
import Inventory from './components/pages/Inventory'
import Reloads from './components/pages/Reloads'
import Orders from './components/pages/Orders'
import Shipments from './components/pages/Shipments'
import Expenses from './components/pages/Expenses'
import Accounts from './components/pages/Accounts'
import Suppliers from './components/pages/Suppliers'
import Settings from './components/pages/Settings'

const PAGES = {
  dashboard: Dashboard,
  sales: Sales,
  inventory: Inventory,
  reloads: Reloads,
  orders: Orders,
  shipments: Shipments,
  expenses: Expenses,
  accounts: Accounts,
  suppliers: Suppliers,
  settings: Settings,
}

function useDarkMode() {
  // Graphite ("Manifest") is the primary theme — default to it until the user
  // has actually made a choice, rather than defaulting new visitors to light.
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('okanemo_dark')
    return stored === null ? true : stored === 'true'
  })

  useEffect(() => {
    document.body.classList.toggle('dark-mode', dark)
    localStorage.setItem('okanemo_dark', dark)
  }, [dark])

  return [dark, () => setDark(d => !d)]
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [darkMode, toggleDark] = useDarkMode()

  const Page = PAGES[activeTab] ?? Dashboard

  return (
    <div className="app-container">
      <Sidebar activeTab={activeTab} onNavigate={setActiveTab} />
      <main className="main-content">
        <TopBar darkMode={darkMode} onToggleDark={toggleDark} notifications={[]} />
        <Page />
      </main>
    </div>
  )
}
