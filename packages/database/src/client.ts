import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

let sqlClient: ReturnType<typeof postgres> | undefined;
let database: Database | undefined;

export function getDatabase(): Database {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to access the BeezOps database.");
  }

  if (!sqlClient) {
    sqlClient = postgres(databaseUrl, { max: 5, prepare: false });
  }
  if (!database) {
    database = drizzle(sqlClient, { schema });
  }

  return database;
}
