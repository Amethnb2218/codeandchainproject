import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { SCHEMA_SQL } from "./schema.js";

function dbPathFromUrl(url: string): string {
  if (url.startsWith("file:")) return url.slice(5);
  return url;
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const p = dbPathFromUrl(config.databaseUrl);
  const dir = path.dirname(p);
  if (p.includes("data/")) fs.mkdirSync("data", { recursive: true });
  else if (dir && dir !== "." && dir !== "./") fs.mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(p);
  db.exec(SCHEMA_SQL);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
