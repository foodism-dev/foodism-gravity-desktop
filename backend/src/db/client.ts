import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type ServerDatabase = ReturnType<typeof createDatabase>;

export function createDatabaseClient(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 10,
    prepare: false,
  });

  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

export function createDatabase(databaseUrl: string) {
  return createDatabaseClient(databaseUrl).db;
}

export function getDatabaseUrl() {
  return Bun.env.DATABASE_URL?.trim() || null;
}
