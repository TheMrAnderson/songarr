import "dotenv/config";

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  openDatabase,
  insertRequest,
  getRequest,
  listRequests,
  deleteRequest,
  retryRequest,
  updateRequest,
  selectCandidate,
} from "./db/database.js";
import { validateIntent } from "./domain.js";
import { LidarrMusicAcquirer } from "./acquirer/index.js";
import {
  PassiveMusicServer,
  NavidromeMusicServer,
  PlexMusicServer,
} from "./musicserver/index.js";
import {
  CombinedTrackMetadataProvider,
  LastFmTrackMetadataProvider,
  MusicBrainzTrackMetadataProvider,
} from "./trackmetadata/index.js";
import { Worker } from "./worker.js";

const db = openDatabase();
const app = express();

app.use(express.json({ limit: "32kb" }));

const trackMetadataProviders = [
  new MusicBrainzTrackMetadataProvider(process.env.MUSICBRAINZ_API_KEY),
  ...(process.env.LASTFM_API_KEY
    ? [new LastFmTrackMetadataProvider(process.env.LASTFM_API_KEY)]
    : []),
];
const trackMetadata = new CombinedTrackMetadataProvider(trackMetadataProviders);

const acquirer =
  process.env.LIDARR_BASE_URL && process.env.LIDARR_API_KEY
    ? new LidarrMusicAcquirer(
        process.env.LIDARR_BASE_URL,
        process.env.LIDARR_API_KEY,
        trackMetadata,
        process.env.LIDARR_ROOT_FOLDER_PATH,
      )
    : new LidarrMusicAcquirer(
        "http://127.0.0.1:8686",
        "not-configured",
        trackMetadata,
        undefined,
      );

const type = process.env.MUSIC_SERVER_TYPE || "passive";
const server =
  type === "navidrome"
    ? new NavidromeMusicServer(
        process.env.MUSIC_SERVER_BASE_URL || "",
        process.env.MUSIC_SERVER_TOKEN,
      )
    : type === "plex"
      ? new PlexMusicServer(
          process.env.MUSIC_SERVER_BASE_URL || "",
          process.env.MUSIC_SERVER_TOKEN,
        )
      : new PassiveMusicServer();

app.get("/api/health", async (_req, res) =>
  res.json({
    process: "ok",
    database: "ok",
    acquisition: await acquirer.check(),
    musicServer: await server.check(),
  }),
);

app.post("/api/requests", (req, res) => {
  const result = validateIntent(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const existing =
    result.value && (result.value as any).clientRequestId
      ? (db
          .prepare("SELECT id FROM requests WHERE client_request_id=?")
          .get((result.value as any).clientRequestId) as any)
      : undefined;
  if (existing) return res.status(200).json(getRequest(db, existing.id));
  const id = crypto.randomUUID();
  return res.status(202).json(insertRequest(db, id, result.value!));
});

app.get("/api/requests", (_req, res) => res.json(listRequests(db)));

app.get("/api/requests/:id", (req, res) => {
  const r = getRequest(db, req.params.id);
  return r ? res.json(r) : res.status(404).json({ error: "Request not found" });
});

app.post("/api/requests/:id/retry", (req, res) => {
  const retried = retryRequest(db, req.params.id);
  return retried
    ? res.status(202).json(getRequest(db, req.params.id))
    : res.status(404).json({ error: "Request not found" });
});

app.delete("/api/requests/:id", (req, res) => {
  const deleted = deleteRequest(db, req.params.id);
  return deleted
    ? res.status(204).send()
    : res.status(404).json({ error: "Request not found" });
});

app.get("/api/requests/:id/candidates", (req, res) => {
  const r = getRequest(db, req.params.id);
  return r
    ? res.json(r.candidates)
    : res.status(404).json({ error: "Request not found" });
});

app.post("/api/requests/:id/selection", (req, res) => {
  const r = getRequest(db, req.params.id);
  if (!r) return res.status(404).json({ error: "Request not found" });
  const c = r.candidates.find((x) => x.id === req.body.candidateId);
  if (!c) return res.status(400).json({ error: "Unknown candidate" });
  selectCandidate(db, r.id, c);
  return res.status(202).json(getRequest(db, r.id));
});

const publicDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "public",
);

app.use(express.static(publicDir));

app.get("/{*splat}", (_req, res) =>
  res.sendFile(path.join(publicDir, "index.html")),
);

const worker = new Worker(
  db,
  acquirer,
  server,
  Number(process.env.WORKER_INTERVAL_MS || 2000),
);

const startupDelayMs =
  Number(process.env.WORKER_STARTUP_DELAY_SECONDS || 10) * 1000;

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(JSON.stringify({ event: "started", port }));
  worker.start(startupDelayMs);
});

process.on("SIGTERM", () => {
  worker.stop();
  db.close();
  process.exit(0);
});
