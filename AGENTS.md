# Songarr engineering guardrails

Songarr is a narrow, intentionally disposable request workflow, not a new music-management platform.

- Inspect existing code before changing architecture and keep the implementation simple.
- Preserve the boundary: Lidarr owns acquisition, indexers, download clients, profiles, importing, naming, tagging, and library management.
- Put real external-service behavior behind adapters (`IMusicAcquirer`, `IMusicServer`). Do not create speculative internal abstractions.
- Verify external APIs against current Lidarr sources/docs; never copy assumptions from another `*arr` project.
- Workflow state and transient candidates are not permanent music-domain state. Do not build a duplicate catalog.
- SQLite schema changes require migrations. Tests must accompany behavior changes.
- Treat API shapes as contracts. Songarr IDs and external IDs are different identities.
- Do not add playlist placement, large queue infrastructure, or a quality-profile engine in Phase 1.
- Do not log secrets. Unauthenticated public deployment requires deliberate protection.
- Prefer boring, inspectable code and leave the repository cleaner than it was found.
