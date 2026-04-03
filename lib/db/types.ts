import type { ColumnType, Generated } from "kysely";

/** Keep in sync with your hand-managed PostgreSQL `users` table. */
export interface UsersTable {
  id: Generated<string>;
  pseudo: string;
  password_hash: string;
  wallet_address: string | null;
  /** Legacy custodial column; unused when wallets are Dynamic MPC. */
  encrypted_private_key: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, never, Date>;
}

export interface Database {
  users: UsersTable;
}
