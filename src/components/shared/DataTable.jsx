/**
 * DataTable — shared table wrapper.
 *
 * Props:
 *   columns     {Array<{ label: ReactNode, style?: object }>} — header definitions
 *   data        {Array}                                      — rows to render
 *   renderRow   {(row, index) => <tr>...</tr>}              — row renderer
 *   emptyState  {ReactNode}                                  — shown when data is empty
 *
 * Usage:
 *   <DataTable
 *     columns={[{ label: 'Date' }, { label: 'Amount' }, { label: 'Actions' }]}
 *     data={expenses}
 *     renderRow={e => (
 *       <tr key={e.id}>
 *         <td>{formatDate(e.date)}</td>
 *         <td>{formatMYR(e.amount)}</td>
 *         <td>...</td>
 *       </tr>
 *     )}
 *     emptyState={<EmptyState icon={Receipt} message="No expenses yet." />}
 *   />
 */
export default function DataTable({ columns = [], data = [], renderRow, emptyState }) {
  // Remounting on every filter/search change replays the fade below, so
  // switching filters reads as a soft transition instead of the table
  // snapping straight to its new height.
  const signature = data.length === 0 ? 'empty' : data.map((row, i) => row?.id ?? i).join('|')

  if (data.length === 0 && emptyState) {
    return (
      <div className="data-table-fade" key={signature}>
        {emptyState}
      </div>
    )
  }

  return (
    <div className="data-table-fade" key={signature}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i} style={col.style}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{data.map((row, i) => renderRow(row, i))}</tbody>
      </table>
    </div>
  )
}
