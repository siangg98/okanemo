/**
 * EmptyState — placeholder for an empty table or list.
 *
 * `icon` is the Lucide component itself:
 *
 *   <EmptyState icon={Package} message="No products yet." />
 */
export default function EmptyState({ icon: Icon, message }) {
  return (
    <div className="empty-state">
      <span>{Icon && <Icon className="icon-empty" aria-hidden="true" />}</span>
      <p>{message}</p>
    </div>
  )
}
