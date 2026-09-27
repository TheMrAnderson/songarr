import type Database from "better-sqlite3";
import {
  claimNext,
  recoverStuckRequests,
  retryRequest,
  saveValidatedCandidate,
  updateRequest,
} from "./db/database.js";
import type { IMusicAcquirer } from "./acquirer/IMusicAcquirer.js";
import type { IMusicServer } from "./musicserver/IMusicServer.js";

function debugLog(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level: "debug", event, ...fields }));
}

export class Worker {
  private timer?: NodeJS.Timeout;
  private startupTimer?: NodeJS.Timeout;

  constructor(
    private db: Database.Database,
    private acquirer: IMusicAcquirer,
    private server: IMusicServer,
    private interval = 2000,
  ) {}

  start(startupDelayMs = 0) {
    const begin = () => {
      debugLog("worker_started", { intervalMs: this.interval });
      this.timer = setInterval(() => void this.tick(), this.interval);
      void this.tick();
    };

    if (startupDelayMs > 0) {
      debugLog("worker_startup_delay", { delayMs: startupDelayMs });
      this.startupTimer = setTimeout(begin, startupDelayMs);
    } else {
      begin();
    }
  }

  stop() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    recoverStuckRequests(this.db);
    const request = claimNext(this.db);
    if (!request) return;

    debugLog("request_processing_started", {
      requestId: request.id,
      state: request.state,
      retryCount: request.retryCount || 0,
      externalJobId: request.externalJobId,
      validated: Boolean(request.validatedCandidate),
    });

    try {
      if (request.state === "received") {
        debugLog("request_resolution_started", { requestId: request.id });
        updateRequest(this.db, request.id, { state: "resolving" });

        const resolved = await this.acquirer.resolve({
          ...request,
          state: "resolving",
        });

        debugLog("request_resolution_completed", {
          requestId: request.id,
          stage: resolved.stage,
          candidateCount: resolved.candidates.length,
        });

        if (resolved.candidates.length !== 1) {
          updateRequest(this.db, request.id, {
            state: "needs_selection",
            stage: resolved.stage,
            candidates: resolved.candidates,
          });
          debugLog("request_needs_selection", {
            requestId: request.id,
            candidateCount: resolved.candidates.length,
          });
          return;
        }

        saveValidatedCandidate(this.db, request.id, resolved.candidates[0]);
        debugLog("request_validated", {
          requestId: request.id,
          artist: resolved.candidates[0].artist,
          track: resolved.candidates[0].track,
          album: resolved.candidates[0].album,
          year: resolved.candidates[0].year,
        });
        updateRequest(this.db, request.id, {
          state: "queued",
          candidates: resolved.candidates,
          selectedCandidate: resolved.candidates[0],
        });
        return;
      }

      if (request.state === "queued") {
        debugLog("acquisition_submission_started", {
          requestId: request.id,
          album: request.validatedCandidate?.album,
          externalId: request.validatedCandidate?.id,
        });
        const job = await this.acquirer.submit(request);

        debugLog("acquisition_submitted", {
          requestId: request.id,
          externalJobId: job.externalJobId,
        });
        updateRequest(this.db, request.id, {
          state: "submitted",
          externalJobId: job.externalJobId,
        });
        return;
      }

      if (
        request.state === "submitted" ||
        request.state === "acquiring" ||
        request.state === "fulfilled"
      ) {
        const status = await this.acquirer.status(
          request.externalJobId!,
          request,
        );
        debugLog("acquisition_status_checked", {
          requestId: request.id,
          externalJobId: request.externalJobId,
          status,
        });

        if (status === "complete") {
          debugLog("request_acquisition_complete", {
            requestId: request.id,
            externalJobId: request.externalJobId,
          });
          await this.server.refresh();
          updateRequest(this.db, request.id, {
            state: "fulfilled",
            selectedCandidate: request.selectedCandidate,
          });
        } else if (status === "failed") {
          const retryCount = (request.retryCount || 0) + 1;
          retryRequest(
            this.db,
            request.id,
            retryCount,
            "Acquisition backend reported failure",
          );
        } else if (status === "queue_deleted") {
          updateRequest(this.db, request.id, {
            state: "queue_deleted",
            error:
              "The selected album was removed from Lidarr before the requested track was downloaded. Use Retry now to add it again.",
          });
        } else {
          debugLog("request_acquiring", {
            requestId: request.id,
            externalJobId: request.externalJobId,
          });
          updateRequest(this.db, request.id, { state: "acquiring" });
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown worker error";

      const retryCount = (request.retryCount || 0) + 1;

      console.error(
        JSON.stringify({
          level: "error",
          event: "request_processing_retry_scheduled",
          requestId: request.id,
          state: request.state,
          retryCount,
          retryState: "received",
          error: errorMessage,
        }),
      );

      retryRequest(this.db, request.id, retryCount, errorMessage);
    }
  }
}
