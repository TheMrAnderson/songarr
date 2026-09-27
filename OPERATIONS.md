# Operations

## Local development

    cp .env.example .env
    npm install
    npm run dev

Local SQLite data is stored at ./data/songarr.db. Useful commands:

    npm test
    npm run lint
    npm run build
    npm run db:migrate

## Docker

    cp .env.example .env
    docker compose up --build

The container stores SQLite at /data/songarr.db. Mount or retain the Compose songarr-data volume.

## Configuration

Required application setup is normally:

- LIDARR_BASE_URL
- LIDARR_API_KEY

Optional Lidarr controls:

- LIDARR_ROOT_FOLDER_PATH (exact Lidarr root folder path for acquisitions)
- MUSICBRAINZ_API_KEY (optional; track-to-release validation)
- LASTFM_API_KEY (optional; track-to-album validation)

Music server settings are optional:

- MUSIC_SERVER_TYPE=passive|navidrome|plex
- MUSIC_SERVER_BASE_URL
- MUSIC_SERVER_TOKEN

Optional retry controls:

- RETRY_INITIAL_DELAY_MINUTES (default: 1)
- RETRY_LONG_INTERVAL_AFTER (default: 10)
- RETRY_LONG_INTERVAL_MINUTES (default: 1440)

Other settings include PORT, WORKER_INTERVAL_MS, WORKER_STARTUP_DELAY_SECONDS, PREFERRED_ENCODING, and RETENTION_DAYS. See .env.example for the complete list.

MusicBrainz track resolution is available without an API key. LASTFM_API_KEY is optional and enables Last.fm cross-checking. Additional providers implement ITrackMetadataProvider and can be added without changing the Lidarr adapter.

## API

- GET /api/health
- POST /api/requests
- GET /api/requests
- GET /api/requests/:id
- GET /api/requests/:id/candidates
- POST /api/requests/:id/selection
- POST /api/requests/:id/retry
- DELETE /api/requests/:id

Request ingestion accepts partial artist, track, album, or playlist fields, plus optional preferredEncoding and clientRequestId. At least one music-identifying field is required. Reusing a client request ID returns the existing request.

Phase 1 does not provide authentication. Do not expose the API publicly without adding deliberate access protection. API keys and music-server tokens must not be committed or logged.

## Health interpretation

Health distinguishes Songarr process/database health, acquisition connectivity, and configured music-server connectivity. A failed acquisition check does not delete requests; the worker retries them.
