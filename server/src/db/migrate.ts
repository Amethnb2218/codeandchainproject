import { getDb, closeDb } from "./index.js";
const db = getDb();
console.log("Migrations appliquees (schema WAL).");
console.log("Tables:", db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all());
closeDb();
