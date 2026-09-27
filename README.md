# Songarr

Songarr is a self-hosted request workflow for music. Users can request a song or album with partial information, resolve ambiguity when needed, and let Lidarr handle acquisition and library management.

It is not a Lidarr replacement or a second music catalog.

## Run locally

Requirements: Node.js 22+ and npm.

    cp .env.example .env
    npm install
    npm run dev

Open http://localhost:3000. Set LIDARR_BASE_URL and LIDARR_API_KEY in .env to enable requests to Lidarr. The complete configuration reference is in [OPERATIONS.md](OPERATIONS.md).

## Run with Docker Compose

Create the environment file, then start the published image:

    cp .env.example .env
    docker compose pull
    docker compose up -d

The image is published as ghcr.io/TheMrAnderson/songarr:latest. Set the GHCR package visibility to Public once in GitHub so this pull works without credentials. To run the current checkout instead, build it locally:

    docker compose up --build

Open http://localhost:3000. Compose stores SQLite data in the named songarr-data volume, mounted at /data in the container. Use docker compose logs -f songarr to follow logs and docker compose down to stop the service.

Start with [the documentation map](DOCUMENTATION.md) for architecture, configuration, API contracts, and operating notes.

The idea and name were sparked by Joe Karlsson's [Self-Hosted Music Still Sucks in 2026](https://www.joekarlsson.com/blog/self-hosted-music-still-sucks-in-2026/).

Songarr is intentionally disposable. If Lidarr eventually adopts this workflow natively, that is a successful outcome for the project.

v0.1.0 Note:
Music-server refresh adapters are included, but real-world validation is pending successful Lidarr import completion.
