# Songarr

Songarr is a self-hosted request workflow for music. Users can request a song or album with partial information, resolve ambiguity when needed, and let Lidarr handle acquisition and library management.

It is not a Lidarr replacement or a second music catalog.

## Quick start

Requirements: Node.js 22+ and npm.

    cp .env.example .env
    npm install
    npm run dev

Open http://localhost:3000. For Docker:

    docker compose up --build

Start with [the documentation map](DOCUMENTATION.md) for architecture, configuration, API contracts, and operating notes.

The idea and name were sparked by Joe Karlsson's [Self-Hosted Music Still Sucks in 2026](https://www.joekarlsson.com/blog/self-hosted-music-still-sucks-in-2026/).

Songarr is intentionally disposable. If Lidarr eventually adopts this workflow natively, that is a successful outcome for the project.

v0.1.0 Note:
Music-server refresh adapters are included, but real-world validation is pending successful Lidarr import completion.
