import type { RequestRecord } from "../domain.js";

export type TrackRelease = {
  id: string;
  artist?: string;
  title?: string;
  year?: number;
};

export type TrackMetadata = {
  releases?: TrackRelease[];
  releaseGroupIds: string[];
  albumTitles: string[];
  trackTitle?: string;
};

export abstract class ITrackMetadataProvider {
  abstract lookup(request: RequestRecord): Promise<TrackMetadata>;
}
