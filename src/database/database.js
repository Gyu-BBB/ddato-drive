import { DatabaseSync } from "node:sqlite";
import { config, ensureDataDirectories } from "../core/config.js";
import { initializeSchema } from "./schema.js";

let db = null;

export function initializeDatabase() {
  ensureDataDirectories();
  db = new DatabaseSync(config.dbFile);
  initializeSchema(db);
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database is not initialized.");
  return db;
}

export function closeDatabase() {
  db?.close();
  db = null;
}

export function withTransaction(callback) {
  const database = getDb();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
