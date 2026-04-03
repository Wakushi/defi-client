import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { Database } from "./types";

const globalForDb = globalThis as unknown as {
  db: Kysely<Database> | undefined;
};

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  const pool = new Pool({
    connectionString: url,
    max: 10,
  });
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

export function getDb(): Kysely<Database> {
  if (!globalForDb.db) {
    globalForDb.db = createDb();
  }
  return globalForDb.db;
}
