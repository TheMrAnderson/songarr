import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  Candidate,
  Intent,
  RequestRecord,
  RequestState,
} from "../domain.js";

const defaultDatabasePath =
  process.env.NODE_ENV === "production"
    ? "/data/songarr.db"
    : "./data/songarr.db";

const retryInitialDelayMs =
  Number(process.env.RETRY_INITIAL_DELAY_MINUTES || 1) * 60 * 1000;
const retryLongIntervalAfter = Number(
  process.env.RETRY_LONG_INTERVAL_AFTER || 10,
);
const retryLongIntervalMs =
  Number(process.env.RETRY_LONG_INTERVAL_MINUTES || 1_440) * 60 * 1000;

export function openDatabase(filename = defaultDatabasePath) {
  fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new Database(filename);

  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);",
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      client_request_id TEXT,
      artist TEXT,
      track TEXT,
      album TEXT,
      playlist TEXT,
      preferred_encoding TEXT,
      state TEXT NOT NULL,
      stage TEXT,
      candidates_json TEXT NOT NULL DEFAULT '[]',
      selected_candidate_json TEXT,
      external_job_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      locked_until TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS requests_client_id
      ON requests(client_request_id)
      WHERE client_request_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS requests_state
      ON requests(state, updated_at);`,
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS validated_requests (
      request_id TEXT PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
      artist TEXT,
      track TEXT,
      album TEXT,
      year INTEGER,
      candidate_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(
    `INSERT OR IGNORE INTO validated_requests (request_id, artist, track, album, year, candidate_json, created_at, updated_at)
     SELECT id, json_extract(selected_candidate_json, '$.artist'), json_extract(selected_candidate_json, '$.track'), json_extract(selected_candidate_json, '$.album'), json_extract(selected_candidate_json, '$.year'), selected_candidate_json, created_at, updated_at
     FROM requests
     WHERE selected_candidate_json IS NOT NULL`,
  ).run();

  const columns = db.prepare("PRAGMA table_info(requests)").all() as Array<{
    name: string;
  }>;

  if (!columns.some((column) => column.name === "retry_count")) {
    db.exec(
      "ALTER TABLE requests ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0",
    );
  }

  if (!columns.some((column) => column.name === "next_attempt_at")) {
    db.exec("ALTER TABLE requests ADD COLUMN next_attempt_at TEXT");
  }

  db.prepare(
    "UPDATE requests SET state = 'received', next_attempt_at = datetime('now'), locked_until = NULL WHERE state = 'failed' AND (error = 'fetch failed' OR error LIKE 'Lidarr request failed%')",
  ).run();

  return db;
}

export function insertRequest(
  db: Database.Database,
  id: string,
  intent: Intent,
): RequestRecord {
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO requests (
      id,
      client_request_id,
      artist,
      track,
      album,
      playlist,
      preferred_encoding,
      state,
      stage,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @clientRequestId,
      @artist,
      @track,
      @album,
      @playlist,
      @preferredEncoding,
      'received',
      NULL,
      @now,
      @now
    )`,
  ).run({
    id,
    clientRequestId:
      (intent as Intent & { clientRequestId?: string }).clientRequestId ?? null,
    artist: intent.artist ?? null,
    track: intent.track ?? null,
    album: intent.album ?? null,
    playlist: intent.playlist ?? null,
    preferredEncoding: intent.preferredEncoding ?? null,
    now,
  });

  return getRequest(db, id)!;
}

export function getRequest(
  db: Database.Database,
  id: string,
): RequestRecord | undefined {
  const row = db
    .prepare(
      "SELECT requests.*, validated_requests.artist AS validated_artist, validated_requests.track AS validated_track, validated_requests.album AS validated_album, validated_requests.year AS validated_year, validated_requests.candidate_json AS validated_candidate_json FROM requests LEFT JOIN validated_requests ON validated_requests.request_id = requests.id WHERE requests.id = ?",
    )
    .get(id) as Record<string, unknown> | undefined;

  return row && map(row);
}

export function listRequests(db: Database.Database): RequestRecord[] {
  return db
    .prepare(
      "SELECT requests.*, validated_requests.artist AS validated_artist, validated_requests.track AS validated_track, validated_requests.album AS validated_album, validated_requests.year AS validated_year, validated_requests.candidate_json AS validated_candidate_json FROM requests LEFT JOIN validated_requests ON validated_requests.request_id = requests.id ORDER BY requests.created_at DESC LIMIT 100",
    )
    .all()
    .map((row) => map(row as Record<string, unknown>));
}

export function updateRequest(
  db: Database.Database,
  id: string,
  patch: Partial<RequestRecord>,
): void {
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE requests
     SET
       state = COALESCE(@state, state),
       stage = COALESCE(@stage, stage),
       candidates_json = COALESCE(@candidates, candidates_json),
       selected_candidate_json = COALESCE(
         @selectedCandidate,
         selected_candidate_json
       ),
       external_job_id = COALESCE(@externalJobId, external_job_id),
       retry_count = COALESCE(@retryCount, retry_count),
       next_attempt_at = @nextAttemptAt,
       error = @error,
       updated_at = @now,
       locked_until = NULL
     WHERE id = @id`,
  ).run({
    id,
    state: patch.state,
    stage: patch.stage,
    candidates: patch.candidates ? JSON.stringify(patch.candidates) : undefined,
    selectedCandidate: patch.selectedCandidate
      ? JSON.stringify(patch.selectedCandidate)
      : undefined,
    externalJobId: patch.externalJobId,
    retryCount: patch.retryCount,
    nextAttemptAt: patch.nextAttemptAt ?? null,
    error: patch.error ?? null,
    now,
  });
}

export function saveValidatedCandidate(
  db: Database.Database,
  id: string,
  candidate: RequestRecord["selectedCandidate"],
): void {
  if (!candidate) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO validated_requests (request_id, artist, track, album, year, candidate_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM validated_requests WHERE request_id = ?), ?), ?)`,
  ).run(
    id,
    candidate.artist ?? null,
    candidate.track ?? null,
    candidate.album ?? null,
    candidate.year ?? null,
    JSON.stringify(candidate),
    id,
    now,
    now,
  );
}

export function selectCandidate(
  db: Database.Database,
  id: string,
  candidate: RequestRecord["selectedCandidate"],
): boolean {
  if (!candidate) return false;
  saveValidatedCandidate(db, id, candidate);
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `UPDATE requests
       SET state = 'queued',
           selected_candidate_json = ?,
           external_job_id = NULL,
           retry_count = 0,
           next_attempt_at = datetime('now'),
           error = NULL,
           locked_until = NULL,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(JSON.stringify(candidate), now, id);
  return result.changes > 0;
}

export function claimNext(db: Database.Database): RequestRecord | undefined {
  const transaction = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT *
         FROM requests
         WHERE state IN ('received', 'queued', 'submitted', 'acquiring')
           AND (locked_until IS NULL OR locked_until < datetime('now'))
           AND (
             next_attempt_at IS NULL
             OR datetime(next_attempt_at) <= datetime('now')
           )
         ORDER BY
           CASE state
             WHEN 'received' THEN 0
             WHEN 'queued' THEN 1
             ELSE 2
           END,
           updated_at,
           created_at
         LIMIT 1`,
      )
      .get() as Record<string, unknown> | undefined;

    if (!row) return undefined;

    db.prepare(
      "UPDATE requests SET locked_until = datetime('now', '+60 seconds'), updated_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), row.id);

    return getRequest(db, String(row.id));
  });

  return transaction();
}

export function recoverStuckRequests(db: Database.Database): void {
  db.prepare(
    `UPDATE requests
     SET
       state = CASE
         WHEN external_job_id IS NULL THEN 'received'
         ELSE 'submitted'
       END,
       next_attempt_at = datetime('now'),
       locked_until = NULL
     WHERE state = 'failed'
        OR (
          state = 'resolving'
          AND updated_at < datetime('now', '-60 seconds')
        )`,
  ).run();

  db.prepare(
    `UPDATE requests
     SET state = 'queued',
         selected_candidate_json = json_extract(candidates_json, '$[0]'),
         next_attempt_at = datetime('now'),
         locked_until = NULL,
         updated_at = ?
     WHERE state = 'needs_selection'
       AND json_array_length(candidates_json) = 1`,
  ).run(new Date().toISOString());
  db.prepare(
    `INSERT OR IGNORE INTO validated_requests (request_id, artist, track, album, year, candidate_json, created_at, updated_at)
     SELECT id, json_extract(selected_candidate_json, '$.artist'), json_extract(selected_candidate_json, '$.track'), json_extract(selected_candidate_json, '$.album'), json_extract(selected_candidate_json, '$.year'), selected_candidate_json, created_at, updated_at
     FROM requests
     WHERE selected_candidate_json IS NOT NULL`,
  ).run();
}

function retryDelayMs(retryCount: number): number {
  if (retryCount <= 0) return 0;
  return retryCount >= retryLongIntervalAfter
    ? retryLongIntervalMs
    : Math.min(300_000, retryInitialDelayMs * 2 ** Math.min(retryCount - 1, 6));
}

export function retryRequest(
  db: Database.Database,
  id: string,
  retryCount = 0,
  error?: string,
): boolean {
  const request = getRequest(db, id);
  if (!request) return false;

  const refreshResolution = Boolean(
    request.error?.includes("did not retain the selected album"),
  );

  if (refreshResolution) {
    db.prepare("DELETE FROM validated_requests WHERE request_id = ?").run(id);
  }

  const selectedCandidate = refreshResolution
    ? undefined
    : (request.validatedCandidate ?? request.selectedCandidate);
  if (selectedCandidate && !request.validatedCandidate) {
    saveValidatedCandidate(db, id, selectedCandidate);
  }
  const retryState = selectedCandidate ? "queued" : "received";
  const candidates = selectedCandidate
    ? request.candidates.length
      ? request.candidates
      : [selectedCandidate]
    : [];
  const nextAttemptAt = new Date(Date.now() + retryDelayMs(retryCount))
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");

  db.prepare(
    `UPDATE requests
     SET state = ?,
         candidates_json = ?,
         selected_candidate_json = ?,
         external_job_id = NULL,
         retry_count = ?,
         next_attempt_at = ?,
         error = ?,
         locked_until = NULL,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    retryState,
    JSON.stringify(candidates),
    selectedCandidate ? JSON.stringify(selectedCandidate) : null,
    retryCount,
    nextAttemptAt,
    error || null,
    new Date().toISOString(),
    id,
  );
  return true;
}

export function deleteRequest(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM requests WHERE id = ?").run(id);
  return result.changes > 0;
}

function map(row: Record<string, unknown>): RequestRecord {
  const candidates = JSON.parse(String(row.candidates_json)) as Candidate[];

  candidates.sort(
    (left, right) =>
      (left.artist || "").localeCompare(right.artist || "") ||
      (left.year ?? Infinity) - (right.year ?? Infinity) ||
      (left.album || "").localeCompare(right.album || ""),
  );

  return {
    id: String(row.id),
    clientRequestId: row.client_request_id
      ? String(row.client_request_id)
      : undefined,
    artist: row.artist ? String(row.artist) : undefined,
    track: row.track ? String(row.track) : undefined,
    album: row.album ? String(row.album) : undefined,
    playlist: row.playlist ? String(row.playlist) : undefined,
    preferredEncoding: row.preferred_encoding
      ? String(row.preferred_encoding)
      : undefined,
    state: String(row.state) as RequestState,
    stage: row.stage as RequestRecord["stage"],
    candidates,
    selectedCandidate: row.selected_candidate_json
      ? JSON.parse(String(row.selected_candidate_json))
      : undefined,
    validatedArtist: row.validated_artist
      ? String(row.validated_artist)
      : undefined,
    validatedTrack: row.validated_track
      ? String(row.validated_track)
      : undefined,
    validatedAlbum: row.validated_album
      ? String(row.validated_album)
      : undefined,
    validatedYear: row.validated_year ? Number(row.validated_year) : undefined,
    validatedCandidate: row.validated_candidate_json
      ? JSON.parse(String(row.validated_candidate_json))
      : undefined,
    externalJobId: row.external_job_id
      ? String(row.external_job_id)
      : undefined,
    retryCount: Number(row.retry_count ?? 0),
    nextAttemptAt: row.next_attempt_at
      ? String(row.next_attempt_at)
      : undefined,
    error: row.error ? String(row.error) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
