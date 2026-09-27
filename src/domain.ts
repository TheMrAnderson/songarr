export const STATES = [
  "received",
  "resolving",
  "needs_selection",
  "queued",
  "submitted",
  "acquiring",
  "fulfilled",
  "failed",
  "queue_deleted",
] as const;

export type RequestState = (typeof STATES)[number];

export type Encoding = "FLAC" | "ALAC" | "MP3" | "AAC" | string;

export type Intent = {
  artist?: string;
  track?: string;
  album?: string;
  playlist?: string;
  preferredEncoding?: Encoding;
  clientRequestId?: string;
};

export type Candidate = {
  id: string;
  artist?: string;
  track?: string;
  album?: string;
  year?: number;
  version?: string;
  encoding?: string;
  metadata?: Record<string, unknown>;
};

export type RequestRecord = Intent & {
  id: string;
  clientRequestId?: string;
  state: RequestState;
  stage?: "identity" | "release" | "encoding";
  selectedCandidate?: Candidate;
  validatedArtist?: string;
  validatedTrack?: string;
  validatedAlbum?: string;
  validatedYear?: number;
  validatedCandidate?: Candidate;
  candidates: Candidate[];
  externalJobId?: string;
  retryCount?: number;
  nextAttemptAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export function validateIntent(input: unknown): {
  value?: Intent;
  error?: string;
} {
  if (!input || typeof input !== "object")
    return { error: "Request body must be an object" };
  const raw = input as Record<string, unknown>;
  const fields = [
    "artist",
    "track",
    "album",
    "playlist",
    "preferredEncoding",
    "clientRequestId",
  ];
  for (const key of fields)
    if (raw[key] !== undefined && typeof raw[key] !== "string")
      return { error: `${key} must be a string` };
  const value: Intent = Object.fromEntries(
    fields
      .filter((k) => typeof raw[k] === "string" && (raw[k] as string).trim())
      .map((k) => [k, (raw[k] as string).trim()]),
  ) as Intent;
  if (!value.artist && !value.track && !value.album && !value.playlist)
    return { error: "At least one music-identifying field is required" };
  return { value };
}
