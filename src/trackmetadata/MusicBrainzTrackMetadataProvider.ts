import type { RequestRecord } from "../domain.js";

import {
  ITrackMetadataProvider,
  TrackMetadata,
} from "./ITrackMetadataProvider.js";

export class MusicBrainzTrackMetadataProvider extends ITrackMetadataProvider {
  private lastRequestAt = 0;

  constructor(private apiKey?: string) {
    super();
  }

  buildQuery(
    request: Pick<RequestRecord, "artist" | "album" | "track">,
  ): string {
    const quote = (value: string) => JSON.stringify(value);
    return [
      request.artist?.trim() ? `artist:${quote(request.artist.trim())}` : "",
      request.album?.trim() ? `release:${quote(request.album.trim())}` : "",
      request.track?.trim() ? `recording:${quote(request.track.trim())}` : "",
      "status:official",
      "(primarytype:album OR primarytype:single)",
    ]
      .filter(Boolean)
      .join(" AND ");
  }

  private normalizeTitle(value: string): string {
    return value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  private async waitForRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const delay = Math.max(0, 1_100 - elapsed);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    this.lastRequestAt = Date.now();
  }

  private async lookupPage(query: string, offset: number): Promise<any> {
    const url =
      "https://musicbrainz.org/ws/2/recording/?query=" +
      encodeURIComponent(query) +
      "&fmt=json&limit=100&offset=" +
      offset;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.waitForRateLimit();
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          "User-Agent": "Songarr/0.1.0 (open-source music request app)",
        },
      });

      if (response.ok) return response.json();

      const retryable =
        response.status === 429 ||
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504;
      if (!retryable || attempt === 2) {
        throw new Error(
          "MusicBrainz track lookup failed with HTTP " + response.status,
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 1_000 * (attempt + 1)),
      );
    }

    throw new Error("MusicBrainz track lookup failed");
  }

  async lookup(request: RequestRecord): Promise<TrackMetadata> {
    const query = this.buildQuery(request);
    const recordings: any[] = [];
    const requestedTrack = request.track?.trim();
    const maxResults = 500;

    for (let offset = 0; offset < maxResults; offset += 100) {
      const body = await this.lookupPage(query, offset);
      const page = body.recordings || [];
      recordings.push(
        ...page.filter(
          (recording: any) =>
            !requestedTrack ||
            this.normalizeTitle(String(recording.title || "")) ===
              this.normalizeTitle(requestedTrack),
        ),
      );
      if (page.length < 100 || offset + page.length >= Number(body.count || 0))
        break;
    }

    const releases = recordings.flatMap((recording: any) =>
      (recording.releases || [])
        .map((release: any) => {
          const id = release["release-group"]?.id;
          if (!id) return undefined;
          const date = String(
            release.date || release["first-release-date"] || "",
          );
          return {
            id: String(id),
            artist: recording["artist-credit"]?.[0]?.name,
            title: release["release-group"]?.title || release.title,
            year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined,
          };
        })
        .filter(Boolean),
    );
    return {
      releases,
      releaseGroupIds: [
        ...new Set(
          recordings.flatMap((recording: any) =>
            (recording.releases || [])
              .map((release: any) => release["release-group"]?.id)
              .filter(Boolean),
          ),
        ),
      ] as string[],
      albumTitles: [],
      trackTitle: recordings[0]?.title
        ? String(recordings[0].title)
        : undefined,
    };
  }
}
