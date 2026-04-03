import type { ColumnType, Generated } from "kysely";

/** Keep in sync with your hand-managed PostgreSQL `users` table. */
export interface UsersTable {
  id: Generated<string>;
  pseudo: string;
  password_hash: string;
  wallet_address: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, never, Date>;
}

/** Partie / duel — paramètres fixés par le créateur, lien partageable. */
export interface DuelsTable {
  id: Generated<string>;
  creator_id: string;
  opponent_id: string | null;
  /** Mise par joueur en USDC (pg renvoie NUMERIC en string). */
  stake_usdc: string;
  /** Fenêtre de temps pour le trade avant fermeture auto. */
  duration_seconds: number;
  /** [créateur, adversaire] chaque slot 0 ou 1 = prêt pour signer. */
  ready_state: unknown;
  /** Horodatage quand les deux sont prêts (synchro compte à rebours). */
  ready_both_at: Date | null;
  creator_trade_config: unknown | null;
  opponent_trade_config: unknown | null;
  created_at: Generated<Date>;
  /** Renseigné par défaut côté SQL ; pas passé à l’insert Kysely. */
  updated_at: ColumnType<Date, never, Date>;
}

export interface Database {
  users: UsersTable;
  duels: DuelsTable;
}
