# Songarr architecture

## System shape

    React UI / external clients
                |
            HTTP API
                |
          SQLite workflow state
                |
          claim-based worker
           /             \
    IMusicAcquirer   IMusicServer
           |             |
         Lidarr    Passive/Navidrome/Plex

Songarr stores workflow state in SQLite. The database is the queue, so no integration but a way to acquire music is needed.

## Request flow

1. The API validates a partial request and assigns a Songarr request ID.
2. An optional client request ID provides idempotent ingestion.
3. The worker claims one actionable request at a time using a SQLite lock window.
4. The acquisition adapter resolves candidates.
5. Ambiguous identity, release, or encoding choices enter needs_selection.
6. A selected request is submitted to the acquisition backend.
7. The worker polls the external job and marks completion or schedules another attempt.
8. The configured music-server adapter is refreshed after successful acquisition. Passive mode intentionally does nothing.

## Boundaries

IMusicAcquirer exposes normalized resolution, submission, and status behavior. LidarrMusicAcquirer contains Lidarr URLs, headers, IDs, commands, and quality/release translation.

IMusicServer exposes health and refresh behavior. PassiveMusicServer is a valid configuration, not a fallback error.

External IDs are adapter data. They are never public Songarr identities.

## Persistence

Requests retain the original user intent and workflow state. Candidate data is transient workflow data; once a candidate is accepted, its canonical artist, track, album, year, provider IDs, and metadata are stored in the one-to-one validated_requests table and become authoritative for acquisition, status, display, and retries. Songarr does not maintain artists, albums, recordings, releases, or library state as authoritative domain tables.

The database path is ./data/songarr.db for local non-production runs and /data/songarr.db in the production container.

## Retry and recovery

Transient worker errors are persisted with exponential backoff. After RETRY_LONG_INTERVAL_AFTER attempts, retries use RETRY_LONG_INTERVAL_MINUTES. The worker watchdog reclaims failed requests and requests stuck in resolving; needs_selection and fulfilled are intentional stops.

## Current external limitation

The current Lidarr adapter uses verified /api/v1 system status, album lookup, artist/album add, local album ID lookup, command submission, and command status patterns. Foreign metadata IDs are never sent as local numeric command IDs. Exact track-level and codec-specific release selection remains constrained by the Lidarr version and is intentionally contained inside the adapter.
