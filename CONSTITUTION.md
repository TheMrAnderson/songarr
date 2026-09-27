# Songarr constitution

## Purpose

Songarr makes self-hosted music approachable for people who want music, not another administration surface. It accepts human requests, helps resolve ambiguity, and delegates acquisition to the system that already knows how to acquire and manage music.

## Non-negotiable principles

- Lidarr owns indexers, download clients, quality profiles, release acquisition, importing, naming, tagging, monitoring, and library management.
- Songarr owns request intent and workflow state, not a duplicate music catalog.
- Ambiguity is a normal user decision, not an error to hide with guessing.
- External services are accessed through narrow adapters.
- The application should remain small, inspectable, and easy to remove.
- Secrets must not appear in logs, source control, or API responses.
- A transient outage must not discard a user's request.

Songarr violates its purpose when it recreates Lidarr, silently chooses a recording the user did not identify, or turns temporary workflow data into permanent catalog state.
