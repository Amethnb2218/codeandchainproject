import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { SCHEMA_SQL } from "./schema.js";

function dbPathFromUrl(url: string): string {
  if (url.startsWith("file:")) return url.slice(5);
  return url;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const p = dbPathFromUrl(config.databaseUrl);
  const dir = path.dirname(p);
  if (dir && dir !== "." && dir !== "./data") fs.mkdirSync(dir, { recursive: true });
  // ensure data dir exists
  if (p.includes("data/")) fs.mkdirSync("data", { recursive: true });
  db = new Database(p);
  db.exec(SCHEMA_SQL);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
