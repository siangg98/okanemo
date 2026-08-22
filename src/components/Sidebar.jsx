import { LayoutDashboard, ShoppingCart, PackageSearch, ArrowLeftRight, ClipboardList, Truck, Receipt, Wallet, Store, Settings } from 'lucide-react'
import logo from '../assets/logo.png'

const NAV = [
  { tab: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { section: 'Sales & Stock' },
  { tab: 'sales', label: 'Sales', icon: ShoppingCart },
  { tab: 'inventory', label: 'Inventory', icon: PackageSearch },
  { section: 'Purchasing' },
  { tab: 'reloads', label: 'Reloads', icon: ArrowLeftRight },
  { tab: 'orders', label: 'Orders', icon: ClipboardList },
  { tab: 'shipments', label: 'Shipments', icon: Truck },
  { tab: 'expenses', label: 'Expenses', icon: Receipt },
  { section: 'Finance' },
  { tab: 'accounts', label: 'Accounts', icon: Wallet },
  { section: 'Manage' },
  { tab: 'suppliers', label: 'Suppliers', icon: Store },
  { tab: 'settings', label: 'Settings', icon: Settings },
]

export default function Sidebar({ activeTab, onNavigate }) {
  return (
    <nav className="sidebar">
      <div className="logo" onClick={() => onNavigate('dashboard')} style={{ cursor: 'pointer' }}>
        {/* Decorative: the wordmark beside it already names the app. */}
        <img src={logo} className="logo-icon" alt="" />
        <span className="logo-text">Okanemo</span>
      </div>
      <ul className="nav-menu">
        {NAV.map((item, i) => {
          if (item.section) {
            return <li key={i} className="nav-section-label">{item.section}</li>
          }
          const Icon = item.icon
          return (
            <li
              key={item.tab}
              className={`nav-item${activeTab === item.tab ? ' active' : ''}`}
              onClick={() => onNavigate(item.tab)}
            >
              <span className="nav-icon"><Icon /></span>
              <span>{item.label}</span>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
