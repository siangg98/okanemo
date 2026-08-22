import { getAccountIcon } from '../../utils/accountIcons'

/**
 * An account's icon, resolved from the name stored on the record.
 *
 * Native `<option>` elements can only hold text, so dropdowns list the account
 * name on its own — this is for the places that accept real markup: cards,
 * table cells, modal titles.
 */
export default function AccountIcon({ name, className = 'icon-inline' }) {
  const Icon = getAccountIcon(name)
  return <Icon className={className} aria-hidden="true" />
}
