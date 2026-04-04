import type { ColumnType, Generated } from "kysely"

/** Keep in sync with your hand-managed PostgreSQL `users` table. */
export interface UsersTable {
  id: Generated<string>
  pseudo: string
  password_hash: string
  wallet_address: string | null
  created_at: Generated<Date>
  updated_at: ColumnType<Date, never, Date>
}

/** Partie / duel — paramètres fixés par le créateur, lien partageable. */
export interface DuelsTable {
  id: Generated<string>
  creator_id: string
  opponent_id: string | null
  /** Mise par joueur en USDC (pg renvoie NUMERIC en string). */
  stake_usdc: string
  /** Fenêtre de temps pour le trade avant fermeture auto. */
  duration_seconds: number
  /** [créateur, adversaire] chaque slot 0 ou 1 = prêt pour signer. */
  ready_state: unknown
  /** Horodatage quand les deux sont prêts (synchro compte à rebours). */
  ready_both_at: Date | null
  creator_trade_config: unknown | null
  opponent_trade_config: unknown | null
  /** Premier `start` WebSocket enregistré côté client/API — duel affiché « en cours ». */
  duel_live_at: Date | null
  /** Fin du chrono duel (WS) enregistrée côté client/API. */
  duel_closed_at: Date | null
  /** PnL USDC finaux (snapshot WS fin de duel), par rôle. */
  creator_pnl_usdc: string | null
  opponent_pnl_usdc: string | null
  creator_pnl_pct: number | null
  opponent_pnl_pct: number | null
  /** `creator` | `opponent` | `tie` — dérivé des PnL quand disponibles. */
  duel_winner_side: string | null
  /** `execute-trade` réussi pour le créateur. */
  creator_trade_opened_at: Date | null
  /** `execute-trade` réussi pour l’adversaire. */
  opponent_trade_opened_at: Date | null
  creator_open_trade_tx_hash: string | null
  opponent_open_trade_tx_hash: string | null
  /** `friendly` = testnet faucet (ex. Arb Sepolia) · `duel` = mainnet réel. */
  play_mode: string
  /** Chaîne Gains pour le créateur, ou sentinelle `unset` (mode duel avant trade ready). */
  creator_chain: string
  /** Chaîne Gains pour l’adversaire. */
  opponent_chain: string
  created_at: Generated<Date>
  /** Renseigné par défaut côté SQL ; pas passé à l’insert Kysely. */
  updated_at: ColumnType<Date, never, Date>
}

export interface Database {
  users: UsersTable
  duels: DuelsTable
}
