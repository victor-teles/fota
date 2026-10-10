import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FsStorage } from "@fota/adapter-fs";
import { SqliteDatabase } from "@fota/adapter-sqlite";
import { MemoryDatabase, MemoryStorage } from "./adapters/memory";
import type { DatabaseAdapter, StorageAdapter } from "./adapters/types";
import { createFotaApp } from "./app";
import { staticApiKeys } from "./auth";

const port = Number(process.env.PORT ?? 3000);
const publicUrl = (process.env.FOTA_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, "");
const dataDir = process.env.FOTA_DATA_DIR;
const apiKeys = (process.env.FOTA_API_KEYS ?? "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

if (apiKeys.length === 0) {
  console.error("FOTA_API_KEYS is not set. Set it to a comma-separated list of CLI API keys.");
  process.exit(1);
}

let db: DatabaseAdapter;
let storage: StorageAdapter;
if (dataDir) {
  mkdirSync(dataDir, { recursive: true });
  db = new SqliteDatabase(join(dataDir, "fota.db"));
  storage = new FsStorage({
    root: join(dataDir, "artifacts"),
    baseUrl: `${publicUrl}/v1/artifacts`,
  });
} else {
  console.warn("FOTA_DATA_DIR is not set; using in-memory storage. Data is lost on restart.");
  db = new MemoryDatabase();
  storage = new MemoryStorage(`${publicUrl}/v1/artifacts`);
}

const app = createFotaApp({ db, storage, auth: staticApiKeys(apiKeys) });
const server = Bun.serve({ port, fetch: app.fetch });

console.log(`fota server listening on ${server.url}`);
