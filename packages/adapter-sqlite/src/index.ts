import { Database } from "bun:sqlite";
import type { App, Patch, PatchState, Platform, Release, TelemetryEvent } from "@fota/protocol";
import type { DatabaseAdapter } from "@fota/server";

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE apps (
     id TEXT PRIMARY KEY,
     name TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE releases (
     app_id TEXT NOT NULL,
     version TEXT NOT NULL,
     platform TEXT NOT NULL,
     engine_revision TEXT NOT NULL,
     base_hashes TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (app_id, version, platform)
   );
   CREATE TABLE patches (
     app_id TEXT NOT NULL,
     release_version TEXT NOT NULL,
     platform TEXT NOT NULL,
     number INTEGER NOT NULL,
     channel TEXT NOT NULL,
     state TEXT NOT NULL,
     rollout_percent INTEGER NOT NULL,
     artifacts TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (app_id, release_version, platform, number)
   );
   CREATE INDEX patches_latest
     ON patches (app_id, release_version, platform, channel, state, number);
   CREATE TABLE events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     type TEXT NOT NULL,
     app_id TEXT NOT NULL,
     release_version TEXT NOT NULL,
     platform TEXT NOT NULL,
     arch TEXT NOT NULL,
     patch_number INTEGER NOT NULL,
     install_id TEXT,
     at TEXT NOT NULL
   );`,
];

interface AppRow {
  id: string;
  name: string | null;
  created_at: string;
}

interface ReleaseRow {
  app_id: string;
  version: string;
  platform: Platform;
  engine_revision: string;
  base_hashes: string;
  created_at: string;
}

interface PatchRow {
  app_id: string;
  release_version: string;
  platform: Platform;
  number: number;
  channel: string;
  state: PatchState;
  rollout_percent: number;
  artifacts: string;
  created_at: string;
}

/**
 * `DatabaseAdapter` backed by SQLite through `bun:sqlite`. Pass a file path (created if missing)
 * or an open `Database`. The schema is migrated on construction; opening a database written by a
 * newer version of this adapter throws instead of guessing.
 */
export class SqliteDatabase implements DatabaseAdapter {
  readonly db: Database;

  constructor(pathOrDatabase: string | Database) {
    this.db =
      typeof pathOrDatabase === "string"
        ? new Database(pathOrDatabase, { create: true, strict: true })
        : pathOrDatabase;
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    migrate(this.db);
  }

  /** Closes the underlying connection. */
  close() {
    this.db.close();
  }

  async getApp(id: string) {
    const row = this.db.query<AppRow, [string]>("SELECT * FROM apps WHERE id = ?").get(id);
    return row ? toApp(row) : undefined;
  }

  async createApp(app: App) {
    const result = this.db
      .query("INSERT INTO apps (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
      .run(app.id, app.name ?? null, app.createdAt);
    return result.changes === 1;
  }

  async getRelease(appId: string, version: string, platform: Platform) {
    const row = this.db
      .query<ReleaseRow, [string, string, string]>(
        "SELECT * FROM releases WHERE app_id = ? AND version = ? AND platform = ?",
      )
      .get(appId, version, platform);
    return row ? toRelease(row) : undefined;
  }

  async createRelease(release: Release) {
    const result = this.db
      .query(
        `INSERT INTO releases (app_id, version, platform, engine_revision, base_hashes, created_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .run(
        release.appId,
        release.version,
        release.platform,
        release.engineRevision,
        JSON.stringify(release.baseHashes),
        release.createdAt,
      );
    return result.changes === 1;
  }

  async getLatestPatch(q: {
    appId: string;
    releaseVersion: string;
    platform: Platform;
    channel: string;
  }) {
    const row = this.db
      .query<PatchRow, [string, string, string, string]>(
        `SELECT * FROM patches
         WHERE app_id = ? AND release_version = ? AND platform = ? AND channel = ?
           AND state = 'active'
         ORDER BY number DESC LIMIT 1`,
      )
      .get(q.appId, q.releaseVersion, q.platform, q.channel);
    return row ? toPatch(row) : undefined;
  }

  async getPatch(appId: string, releaseVersion: string, platform: Platform, number: number) {
    const row = this.db
      .query<PatchRow, [string, string, string, number]>(
        `SELECT * FROM patches
         WHERE app_id = ? AND release_version = ? AND platform = ? AND number = ?`,
      )
      .get(appId, releaseVersion, platform, number);
    return row ? toPatch(row) : undefined;
  }

  async createPatch(input: Omit<Patch, "number">) {
    const create = this.db.transaction(() => {
      const row = this.db
        .query<{ highest: number }, [string, string, string]>(
          `SELECT COALESCE(MAX(number), 0) AS highest FROM patches
           WHERE app_id = ? AND release_version = ? AND platform = ?`,
        )
        .get(input.appId, input.releaseVersion, input.platform);
      const patch: Patch = { ...input, number: (row?.highest ?? 0) + 1 };
      this.writePatch(patch, "INSERT");
      return patch;
    });
    return create.immediate();
  }

  async putPatch(patch: Patch) {
    this.writePatch(patch, "INSERT OR REPLACE");
  }

  async recordEvents(events: TelemetryEvent[]) {
    const insert = this.db.query(
      `INSERT INTO events
         (type, app_id, release_version, platform, arch, patch_number, install_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      for (const e of events) {
        insert.run(
          e.type,
          e.appId,
          e.releaseVersion,
          e.platform,
          e.arch,
          e.patchNumber,
          e.installId ?? null,
          e.at,
        );
      }
    })();
  }

  private writePatch(patch: Patch, verb: "INSERT" | "INSERT OR REPLACE") {
    this.db
      .query(
        `${verb} INTO patches
           (app_id, release_version, platform, number, channel, state, rollout_percent,
            artifacts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        patch.appId,
        patch.releaseVersion,
        patch.platform,
        patch.number,
        patch.channel,
        patch.state,
        patch.rolloutPercent,
        JSON.stringify(patch.artifacts),
        patch.createdAt,
      );
  }
}

function migrate(db: Database) {
  const row = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  const version = row?.user_version ?? 0;
  if (version > MIGRATIONS.length) {
    throw new Error(
      `SQLite schema version ${version} is newer than this adapter supports (${MIGRATIONS.length}); upgrade @fota/adapter-sqlite`,
    );
  }
  db.transaction(() => {
    for (let i = version; i < MIGRATIONS.length; i++) {
      db.exec(MIGRATIONS[i] ?? "");
    }
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
  }).immediate();
}

function toApp(row: AppRow): App {
  return row.name === null
    ? { id: row.id, createdAt: row.created_at }
    : { id: row.id, name: row.name, createdAt: row.created_at };
}

function toRelease(row: ReleaseRow): Release {
  return {
    appId: row.app_id,
    version: row.version,
    platform: row.platform,
    engineRevision: row.engine_revision,
    baseHashes: JSON.parse(row.base_hashes) as Release["baseHashes"],
    createdAt: row.created_at,
  };
}

function toPatch(row: PatchRow): Patch {
  return {
    appId: row.app_id,
    releaseVersion: row.release_version,
    platform: row.platform,
    number: row.number,
    channel: row.channel,
    state: row.state,
    rolloutPercent: row.rollout_percent,
    artifacts: JSON.parse(row.artifacts) as Patch["artifacts"],
    createdAt: row.created_at,
  };
}
