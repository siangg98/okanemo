/**
 * StatCard — a headline figure with a Lucide icon.
 *
 * `icon` is the component itself, not an element, so the card controls its own
 * sizing and colour through `.stat-icon svg` and the `iconClass` tint:
 *
 *   <StatCard icon={Banknote} iconClass="investment" label="…" value="…" />
 */
export default function StatCard({ icon: Icon, iconClass, label, value, valueClass, sub }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon${iconClass ? ` ${iconClass}` : ''}`}>
        {Icon && <Icon aria-hidden="true" />}
      </div>
      <div className="stat-info">
        <span className="stat-label">{label}</span>
        <span className={`stat-value${valueClass ? ` ${valueClass}` : ''}`}>{value}</span>
        {sub && <span className="stat-sub">{sub}</span>}
      </div>
    </div>
  )
}
