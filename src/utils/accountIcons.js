import {
  Landmark,
  Wallet,
  PiggyBank,
  CreditCard,
  Banknote,
  Coins,
  HandCoins,
  WalletCards,
  Smartphone,
  Building2,
  Globe,
  Bitcoin,
} from 'lucide-react'

/**
 * The icons an account can wear.
 *
 * Accounts persist the `name`, never the component: a component reference does
 * not survive `JSON.stringify`, so it could not sit in localStorage or in a
 * Settings backup. Names are kebab-case to match Lucide's own naming, which
 * keeps them readable in an exported JSON file.
 */
export const ACCOUNT_ICONS = [
  { name: 'landmark', label: 'Bank', Icon: Landmark },
  { name: 'wallet', label: 'Wallet', Icon: Wallet },
  { name: 'piggy-bank', label: 'Savings', Icon: PiggyBank },
  { name: 'credit-card', label: 'Card', Icon: CreditCard },
  { name: 'banknote', label: 'Cash', Icon: Banknote },
  { name: 'coins', label: 'Coins', Icon: Coins },
  { name: 'hand-coins', label: 'Agent', Icon: HandCoins },
  { name: 'wallet-cards', label: 'E-wallet', Icon: WalletCards },
  { name: 'smartphone', label: 'Mobile', Icon: Smartphone },
  { name: 'building-2', label: 'Business', Icon: Building2 },
  { name: 'globe', label: 'Overseas', Icon: Globe },
  { name: 'bitcoin', label: 'Crypto', Icon: Bitcoin },
]

export const DEFAULT_ACCOUNT_ICON = 'landmark'
export const DEFAULT_WALLET_ICON = 'wallet'

const BY_NAME = new Map(ACCOUNT_ICONS.map(i => [i.name, i.Icon]))

/** True when `name` is one of the registry's icon names. */
export function isAccountIconName(name) {
  return BY_NAME.has(name)
}

/**
 * Component for a stored icon name. Falls back rather than returning undefined
 * so an unrecognised name leaves a plain icon behind, not a blank card.
 */
export function getAccountIcon(name) {
  return BY_NAME.get(name) || Landmark
}

/**
 * Emoji that accounts carried before the registry existed, mapped to their
 * closest icon. Only the ones this app ever shipped or suggested are listed —
 * a hand-typed emoji outside this map falls back by currency in
 * `migrateAccountIconNames`.
 */
export const LEGACY_EMOJI_ICONS = {
  '🏦': 'landmark',
  '🏧': 'landmark',
  '💴': 'wallet',
  '💵': 'banknote',
  '💶': 'wallet',
  '💷': 'wallet',
  '💰': 'banknote',
  '💸': 'banknote',
  '💳': 'credit-card',
  '💱': 'coins',
  '🪙': 'coins',
  '🐷': 'piggy-bank',
  '🐖': 'piggy-bank',
  '📱': 'smartphone',
  '🏢': 'building-2',
  '🌏': 'globe',
  '🌍': 'globe',
  '🌐': 'globe',
  '₿': 'bitcoin',
}
