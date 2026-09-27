import { describe, expect, it } from "vitest";
import {
  openDatabase,
  insertRequest,
  getRequest,
  selectCandidate,
  recoverStuckRequests,
  saveValidatedCandidate,
} from "./db/database.js";
import { Worker } from "./worker.js";
import type { IMusicAcquirer } from "./acquirer/IMusicAcquirer.js";
import type { IMusicServer } from "./musicserver/IMusicServer.js";

const fake: IMusicAcquirer = {
  check: async () => true,
  resolve: async () => ({
    candidates: [{ id: "1", artist: "A", album: "B", encoding: "FLAC" }],
  }),
  submit: async () => ({ externalJobId: "job" }),
  status: async () => "complete",
};

const passive: IMusicServer = {
  check: async () => true,
  refresh: async () => {},
};

describe("worker workflow", () => {
  it("resolves submits and fulfills", async () => {
    const db = openDatabase(":memory:");
    const r = insertRequest(db, "r1", {
      track: "Song",
      preferredEncoding: "FLAC",
    });
    const w = new Worker(db, fake, passive, 1);
    await w.tick();
    await w.tick();
    await w.tick();
    expect(getRequest(db, r.id)?.state).toBe("fulfilled");
    db.close();
  });
  it("does not process two claims at once", () => {
    const db = openDatabase(":memory:");
    insertRequest(db, "r1", { track: "Song" });
    const a = (
      db.prepare("SELECT id FROM requests WHERE state='received'").get() as any
    ).id;
    db.prepare(
      "UPDATE requests SET locked_until=datetime('now','+60 seconds') WHERE id=?",
    ).run(a);
    expect(
      db
        .prepare(
          "SELECT id FROM requests WHERE state='received' AND (locked_until IS NULL OR locked_until < datetime('now'))",
        )
        .get(),
    ).toBeUndefined();
    db.close();
  });
});

const unavailable: IMusicAcquirer = {
  check: async () => false,
  resolve: async () => {
    throw new Error("fetch failed");
  },
  submit: async () => ({ externalJobId: "unused" }),
  status: async () => "pending",
};

describe("worker retries", () => {
  it("returns transient failures to a retryable state", async () => {
    const db = openDatabase(":memory:");
    insertRequest(db, "retry-1", { track: "Song" });

    await new Worker(db, unavailable, passive, 1).tick();

    const request = getRequest(db, "retry-1");
    expect(request?.state).toBe("received");
    expect(request?.retryCount).toBe(1);
    expect(request?.nextAttemptAt).toBeTruthy();
    expect(request?.error).toBe("fetch failed");
    db.close();
  });

  it("automatically selects the only release even without an encoding hint", async () => {
    const db = openDatabase(":memory:");
    insertRequest(db, "single-release-1", {
      track: "Song",
      preferredEncoding: "FLAC",
    });
    const acquirer: IMusicAcquirer = {
      ...fake,
      resolve: async () => ({
        candidates: [{ id: "only", artist: "A", album: "B" }],
      }),
    };

    await new Worker(db, acquirer, passive, 1).tick();

    const request = getRequest(db, "single-release-1");
    expect(request?.state).toBe("queued");
    expect(request?.selectedCandidate?.id).toBe("only");
    db.close();
  });
});

describe("selection reset", () => {
  it("promotes an existing single-candidate selection", () => {
    const db = openDatabase(":memory:");
    insertRequest(db, "legacy-single-1", { track: "Song" });
    const candidate = { id: "only", artist: "Artist", album: "Album" };
    db.prepare(
      "UPDATE requests SET state = 'needs_selection', candidates_json = ? WHERE id = ?",
    ).run(JSON.stringify([candidate]), "legacy-single-1");

    recoverStuckRequests(db);

    const request = getRequest(db, "legacy-single-1");
    expect(request?.state).toBe("queued");
    expect(request?.selectedCandidate).toEqual(candidate);
    db.close();
  });

  it("clears stale command state when a candidate is selected", () => {
    const db = openDatabase(":memory:");
    insertRequest(db, "selection-1", { track: "Song" });
    db.prepare(
      "UPDATE requests SET external_job_id = ?, retry_count = 5, error = ? WHERE id = ?",
    ).run("old-command", "old failure", "selection-1");

    const candidate = { id: "album-1", artist: "Artist", album: "Album" };
    expect(selectCandidate(db, "selection-1", candidate)).toBe(true);

    const request = getRequest(db, "selection-1");
    expect(request?.state).toBe("queued");
    expect(request?.selectedCandidate).toEqual(candidate);
    expect(request?.externalJobId).toBeUndefined();
    expect(request?.retryCount).toBe(0);
    expect(request?.error).toBeUndefined();
    db.close();
  });
});

describe("manual retry", () => {
  it("requeues the existing request and resets retry timing", async () => {
    const db = openDatabase(":memory:");
    insertRequest(db, "manual-1", { track: "Song" });
    const candidate = { id: "album-1", artist: "Artist", album: "Album" };
    db.prepare(
      "UPDATE requests SET state = 'failed', retry_count = 12, error = 'fetch failed', candidates_json = ?, selected_candidate_json = ? WHERE id = ?",
    ).run(JSON.stringify([candidate]), JSON.stringify(candidate), "manual-1");
    saveValidatedCandidate(db, "manual-1", candidate);
    const { retryRequest } = await import("./db/database.js");
    expect(retryRequest(db, "manual-1")).toBe(true);
    const request = getRequest(db, "manual-1");
    expect(request?.state).toBe("queued");
    expect(request?.selectedCandidate).toEqual(candidate);
    expect(request?.retryCount).toBe(0);
    expect(request?.error).toBeUndefined();
    db.close();
  });
});

describe("request candidate ordering", () => {
  it("sorts persisted candidates by artist, album, then year when reading", () => {
    const db = openDatabase(":memory:");
    insertRequest(db, "ordered-1", { track: "Hurt" });
    db.prepare("UPDATE requests SET candidates_json = ? WHERE id = ?").run(
      JSON.stringify([
        { id: "3", artist: "Roy Hamilton", album: "Hurt", year: 1954 },
        {
          id: "1",
          artist: "Elvis Presley",
          album: "For the Heart",
          year: 1976,
        },
        { id: "2", artist: "Elvis Presley", album: "Hurt", year: 1976 },
      ]),
      "ordered-1",
    );

    expect(
      getRequest(db, "ordered-1")?.candidates.map((candidate) => candidate.id),
    ).toEqual(["1", "2", "3"]);
    db.close();
  });
});

it("re-resolves when the selected album is no longer retained by Lidarr", async () => {
  const db = openDatabase(":memory:");
  insertRequest(db, "stale-selection-1", { track: "Song" });
  const candidate = { id: "album-1", artist: "Artist", album: "Album" };
  selectCandidate(db, "stale-selection-1", candidate);
  db.prepare("UPDATE requests SET error = ? WHERE id = ?").run(
    'Lidarr did not retain the selected album "Album" after the search command completed.',
    "stale-selection-1",
  );

  const { retryRequest } = await import("./db/database.js");
  expect(retryRequest(db, "stale-selection-1")).toBe(true);
  const request = getRequest(db, "stale-selection-1");
  expect(request?.state).toBe("received");
  expect(request?.selectedCandidate).toBeUndefined();
  expect(request?.validatedCandidate).toBeUndefined();
  expect(request?.candidates).toEqual([]);
  db.close();
});
