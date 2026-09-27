# Implementation notes

- The Lidarr adapter intentionally uses album-oriented /api/v1 operations. Track-level and exact codec selection vary by Lidarr version and must remain adapter-local.
- SQLite uses WAL mode and a busy timeout. The worker uses a lock window to prevent duplicate claims across processes.
- Existing transient failures are requeued during database startup; stale resolving requests are recovered by the worker watchdog.
- The UI refreshes the request list every two seconds and displays the next retry time.
- Playlist persistence and playlist placement are deliberately deferred. Preserve the seam for future Songarr-owned playlist identities without exposing external playlist IDs as public IDs.
- The project uses a local schema bootstrap plus compatibility column additions for the current small Phase 1 database. Future schema changes should become explicit versioned migrations before the schema grows.
