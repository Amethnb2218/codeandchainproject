import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { SCHEMA_SQL } from "./schema.js";

function dbPathFromUrl(url: string): string {
  const raw = url.startsWith("file:") ? url.slice(5) : url;
  if (path.isAbsolute(raw)) return raw;
  // Resout les chemins relatifs depuis la racine du projet (2 niveaux au-dessus de server/src/db)
  // Evite la creation d'une DB parasite dans server/data quand le process est lance depuis server/
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(thisDir, "..", "..", "..");
  return path.resolve(projectRoot, raw);
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const p = dbPathFromUrl(config.databaseUrl);
  const dir = path.dirname(p);
  if (dir && dir !== "." && dir !== "./") fs.mkdirSync(dir, { recursive: true });
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
