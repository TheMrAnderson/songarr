import type { Candidate, RequestRecord } from "../domain.js";

export interface IMusicAcquirer {
  check(): Promise<boolean>;
  resolve(
    request: RequestRecord,
  ): Promise<{ candidates: Candidate[]; stage?: RequestRecord["stage"] }>;
  submit(request: RequestRecord): Promise<{ externalJobId: string }>;
  status(
    externalJobId: string,
    request: RequestRecord,
  ): Promise<"pending" | "complete" | "failed" | "queue_deleted">;
}
