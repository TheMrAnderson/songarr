import type { RequestRecord } from "../domain.js";
import {
  ITrackMetadataProvider,
  TrackMetadata,
} from "./ITrackMetadataProvider.js";

export class LastFmTrackMetadataProvider extends ITrackMetadataProvider {
  constructor(private apiKey: string) {
    super();
  }

  async lookup(request: RequestRecord): Promise<TrackMetadata> {
    const params = new URLSearchParams({
      method: "track.getInfo",
      api_key: this.apiKey,
      artist: request.artist || "",
      track: request.track || "",
      autocorrect: "1",
      format: "json",
    });
    const response = await fetch(
      "https://ws.audioscrobbler.com/2.0/?" + params,
    );
    if (!response.ok)
      throw new Error(
        "Last.fm track lookup failed with HTTP " + response.status,
      );
    const body = (await response.json()) as any;
    if (body.error)
      throw new Error("Last.fm track lookup failed: " + body.message);
    const releases = body.track?.album?.mbid
      ? [
          {
            id: String(body.track.album.mbid),
            title: body.track.album.title
              ? String(body.track.album.title)
              : undefined,
          },
        ]
      : [];
    return {
      releases,
      releaseGroupIds: body.track?.album?.mbid
        ? [String(body.track.album.mbid)]
        : [],
      albumTitles: body.track?.album?.title
        ? [String(body.track.album.title)]
        : [],
      trackTitle: body.track?.name ? String(body.track.name) : undefined,
    };
  }
}
