import type { Candidate, RequestRecord } from "../domain.js";
import {
  ITrackMetadataProvider,
  TrackMetadata,
} from "./ITrackMetadataProvider.js";

export class CombinedTrackMetadataProvider extends ITrackMetadataProvider {
  constructor(private providers: ITrackMetadataProvider[]) {
    super();
  }

  async lookup(request: RequestRecord): Promise<TrackMetadata> {
    const settled = await Promise.allSettled(
      this.providers.map((provider) => provider.lookup(request)),
    );
    const failures: string[] = [];
    const results = settled.flatMap((result, index) => {
      if (result.status === "fulfilled") return [result.value];

      const error =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      const provider = this.providers[index].constructor.name;
      failures.push(provider + ": " + error);
      console.error(
        JSON.stringify({
          level: "error",
          event: "track_metadata_provider_failed",
          provider,
          error,
        }),
      );
      return [];
    });

    if (!results.length) {
      throw new Error(
        "All track metadata providers failed: " + failures.join("; "),
      );
    }
    return {
      releases: [
        ...new Map(
          results
            .flatMap((result) => result.releases || [])
            .map((release) => [
              [release.artist || "", release.title || ""]
                .join("\u0000")
                .toLowerCase(),
              release,
            ]),
        ).values(),
      ],
      releaseGroupIds: [
        ...new Set(results.flatMap((result) => result.releaseGroupIds)),
      ],
      albumTitles: [
        ...new Set(results.flatMap((result) => result.albumTitles)),
      ],
      trackTitle: results.find((result) => result.trackTitle)?.trackTitle,
    };
  }

  matches(candidate: Candidate, metadata: TrackMetadata) {
    const idMatches =
      !metadata.releaseGroupIds.length ||
      metadata.releaseGroupIds.includes(candidate.id);
    const titleMatches =
      !metadata.albumTitles.length ||
      metadata.albumTitles.some(
        (title) =>
          title.toLowerCase() === String(candidate.album).toLowerCase(),
      );
    return idMatches && titleMatches;
  }
}
