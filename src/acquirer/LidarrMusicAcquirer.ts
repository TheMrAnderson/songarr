import type { Candidate, RequestRecord } from "../domain.js";
import type { ITrackMetadataProvider } from "../trackmetadata/ITrackMetadataProvider.js";
import { IMusicAcquirer } from "./IMusicAcquirer.js";
import { describeError, normalizeTitle } from "./utils.js";

export class LidarrMusicAcquirer implements IMusicAcquirer {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private trackMetadata: ITrackMetadataProvider,
    private rootFolderPath?: string,
  ) {}

  private normalizeRootPath(value: string): string {
    const normalized = value.trim().replace(/\/+$/, "");
    return normalized || "/";
  }

  private artistMatches(
    requestedArtist: string,
    candidateArtist: string,
    verifiedArtists: Set<string>,
  ): boolean {
    const requested = normalizeTitle(requestedArtist);
    const candidate = normalizeTitle(candidateArtist);

    return (
      candidate === requested ||
      candidate.includes(requested) ||
      requested.includes(candidate) ||
      verifiedArtists.has(candidate)
    );
  }

  private async request(path: string, init?: RequestInit) {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/v1${path}`;
    let response: Response;

    console.log(
      JSON.stringify({
        level: "debug",
        event: "lidarr_request_started",
        method: init?.method || "GET",
        origin: new URL(this.baseUrl).origin,
        path,
      }),
    );

    try {
      response = await fetch(url, {
        ...init,
        headers: {
          "X-Api-Key": this.apiKey,
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "lidarr_request_failed",
          method: init?.method || "GET",
          origin: new URL(this.baseUrl).origin,
          path,
          error: describeError(error),
        }),
      );
      const detail =
        error instanceof Error && error.cause instanceof Error
          ? error.cause.message
          : error instanceof Error
            ? error.message
            : String(error);
      throw new Error(
        "Unable to reach Lidarr at " +
          new URL(this.baseUrl).origin +
          " while requesting " +
          path +
          ". Check that Lidarr is running and LIDARR_BASE_URL points to the correct host and port. Network detail: " +
          detail,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new Error(`Lidarr ${response.status} ${path}`);
    }

    return response.json();
  }

  async check() {
    try {
      await this.request("/system/status");
      return true;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "lidarr_health_check_failed",
          origin: new URL(this.baseUrl).origin,
          error: describeError(error),
        }),
      );
      return false;
    }
  }

  private async lookupVerifiedReleases(releaseGroupIds: string[]) {
    const ids = [...new Set(releaseGroupIds)];
    if (!ids.length) {
      throw new Error("No verified release matched the request.");
    }

    const results = (
      await Promise.all(
        ids.map(async (releaseGroupId) => {
          const albums = (await this.request(
            "/album/lookup?term=" +
              encodeURIComponent("lidarr:" + releaseGroupId),
          )) as any[];
          return albums.filter(
            (album) => String(album.foreignAlbumId) === releaseGroupId,
          );
        }),
      )
    ).flat();

    return results as any[];
  }

  private async lookupByText(request: RequestRecord) {
    const term = [request.artist, request.album].filter(Boolean).join(" - ");
    return (await this.request(
      "/album/lookup?term=" + encodeURIComponent(term),
    )) as any[];
  }

  async resolve(request: RequestRecord) {
    const hasTrack = Boolean(request.track?.trim());
    const metadata = hasTrack
      ? await this.trackMetadata.lookup(request)
      : { releaseGroupIds: [], albumTitles: [] };

    if (hasTrack && !metadata.trackTitle?.trim()) {
      throw new Error(
        "No canonical track title was returned by the track metadata providers.",
      );
    }

    const verifiedArtists = new Set(
      (metadata.releases || [])
        .map((release) => release.artist)
        .filter((artist): artist is string => Boolean(artist))
        .map(normalizeTitle),
    );

    const results = hasTrack
      ? await this.lookupVerifiedReleases(metadata.releaseGroupIds)
      : await this.lookupByText(request);
    const candidates = results
      .filter(
        (candidate, index, all) =>
          all.findIndex(
            (item) => item.foreignAlbumId === candidate.foreignAlbumId,
          ) === index,
      )
      .map((x: any) => ({
        id: String(x.foreignAlbumId),
        artist: x.artist?.artistName || request.artist,
        album: x.title,
        track: metadata.trackTitle || request.track,
        year: x.releaseDate
          ? Number(String(x.releaseDate).slice(0, 4)) >= 1000
            ? Number(String(x.releaseDate).slice(0, 4))
            : undefined
          : undefined,
        metadata: x,
      }))
      .filter(
        (candidate) =>
          (!request.artist ||
            !candidate.artist ||
            this.artistMatches(
              request.artist,
              candidate.artist,
              verifiedArtists,
            )) &&
          (!metadata.releaseGroupIds.length ||
            metadata.releaseGroupIds.includes(candidate.id)) &&
          (!request.album?.trim() ||
            !metadata.albumTitles.length ||
            metadata.albumTitles.some(
              (title) =>
                title.toLowerCase() === String(candidate.album).toLowerCase(),
            )),
      );

    if (!candidates.length) {
      throw new Error(
        'No verified album contains the requested track "' +
          request.track +
          '".',
      );
    }

    candidates.sort(
      (left, right) =>
        (left.artist || "").localeCompare(right.artist || "") ||
        (left.year ?? Infinity) - (right.year ?? Infinity) ||
        (left.album || "").localeCompare(right.album || ""),
    );

    return {
      candidates,
      stage:
        candidates.length === 1 ? ("release" as const) : ("identity" as const),
    };
  }
  private async addOrFindAlbum(candidate: Candidate): Promise<number> {
    const metadata = candidate.metadata as Record<string, any> | undefined;
    const foreignAlbumId = String(
      metadata?.foreignAlbumId || candidate.id || "",
    );
    const lookupArtist = metadata?.artist;

    if (!foreignAlbumId || !lookupArtist?.foreignArtistId) {
      throw new Error(
        "The selected Lidarr candidate is missing the foreign album or artist ID required for submission.",
      );
    }

    const existingAlbums = (await this.request(
      `/album?foreignAlbumId=${encodeURIComponent(foreignAlbumId)}`,
    )) as any[];
    const existingAlbum = existingAlbums.find(
      (album) => Number.isInteger(album.id) && album.id > 0,
    );
    if (existingAlbum) return existingAlbum.id;

    const artists = (await this.request("/artist")) as any[];
    let artist = artists.find(
      (item) => item.foreignArtistId === lookupArtist.foreignArtistId,
    );

    const configuredRoot = this.rootFolderPath?.trim();
    const normalizedConfiguredRoot = configuredRoot
      ? this.normalizeRootPath(configuredRoot)
      : undefined;

    if (
      artist &&
      normalizedConfiguredRoot &&
      this.normalizeRootPath(artist.rootFolderPath) !== normalizedConfiguredRoot
    ) {
      throw new Error(
        "Lidarr already has this artist at " +
          artist.rootFolderPath +
          ", which does not match LIDARR_ROOT_FOLDER_PATH " +
          configuredRoot +
          ". Use a separate Lidarr instance or move the artist before retrying.",
      );
    }

    if (!artist) {
      const rootFolders = (await this.request("/rootfolder")) as any[];
      const rootFolder = normalizedConfiguredRoot
        ? rootFolders.find(
            (folder) =>
              this.normalizeRootPath(folder.path) === normalizedConfiguredRoot,
          )
        : rootFolders.length === 1
          ? rootFolders[0]
          : undefined;
      if (!rootFolder?.path) {
        throw new Error(
          configuredRoot
            ? 'Lidarr does not have the configured root folder "' +
                configuredRoot +
                '". Add that folder in Lidarr or update LIDARR_ROOT_FOLDER_PATH.'
            : "Lidarr has multiple root folders. Set LIDARR_ROOT_FOLDER_PATH to the one Songarr should use.",
        );
      }

      const qualityProfiles = (await this.request("/qualityprofile")) as any[];
      const metadataProfiles = (await this.request(
        "/metadataprofile",
      )) as any[];
      const qualityProfileId =
        rootFolder.defaultQualityProfileId || qualityProfiles[0]?.id;
      const metadataProfileId =
        rootFolder.defaultMetadataProfileId ||
        metadataProfiles.find((profile) => profile.name !== "None")?.id;

      if (!qualityProfileId || !metadataProfileId) {
        throw new Error(
          "Lidarr is missing a usable quality or metadata profile.",
        );
      }

      artist = {
        artistName: lookupArtist.artistName,
        foreignArtistId: lookupArtist.foreignArtistId,
        qualityProfileId,
        metadataProfileId,
        rootFolderPath: rootFolder.path,
        monitored: true,
        addOptions: {
          monitor: "none",
          searchForMissingAlbums: false,
        },
      };
    }

    const added = await this.request("/album", {
      method: "POST",
      body: JSON.stringify({
        foreignAlbumId,
        title: metadata?.title || candidate.album,
        monitored: true,
        anyReleaseOk: true,
        artist,
        addOptions: {
          searchForNewAlbum: false,
        },
      }),
    });

    const returnedAlbumId = Number(added?.id ?? added);
    const returnedForeignAlbumId = String(added?.foreignAlbumId || "");
    if (
      returnedForeignAlbumId === foreignAlbumId &&
      Number.isInteger(returnedAlbumId) &&
      returnedAlbumId > 0
    ) {
      return returnedAlbumId;
    }

    const persistedAlbums = (await this.request(
      "/album?foreignAlbumId=" + encodeURIComponent(foreignAlbumId),
    )) as any[];
    const persistedAlbum = persistedAlbums.find(
      (album) =>
        String(album.foreignAlbumId) === foreignAlbumId &&
        Number.isInteger(album.id) &&
        album.id > 0,
    );
    if (persistedAlbum) return persistedAlbum.id;

    throw new Error(
      'Lidarr did not retain the selected album "' +
        candidate.album +
        '" (' +
        foreignAlbumId +
        ") after adding it.",
    );
  }

  async submit(request: RequestRecord) {
    if (!request.validatedCandidate) {
      throw new Error("A resolved Lidarr album candidate is required");
    }

    const albumId = await this.addOrFindAlbum(request.validatedCandidate);
    const result = await this.request("/command", {
      method: "POST",
      body: JSON.stringify({
        name: "AlbumSearch",
        albumIds: [albumId],
      }),
    });

    return { externalJobId: String(result.id) };
  }

  private async noDownloadMessage(id: string, album: any) {
    let releases: any[] = [];
    try {
      releases = (await this.request(
        "/release?albumId=" + encodeURIComponent(album.id),
      )) as any[];
    } catch (error) {
      return (
        "Lidarr command " +
        id +
        ' found no downloadable release for "' +
        album.title +
        '". Songarr could not inspect Lidarr rejection details: ' +
        (error instanceof Error ? error.message : String(error)) +
        " Check Lidarr indexer and download-client settings."
      );
    }

    const reasons = new Map<string, number>();
    for (const release of releases) {
      for (const reason of release.rejections || []) {
        reasons.set(reason, (reasons.get(reason) || 0) + 1);
      }
    }
    const reasonSummary = [...reasons.entries()]
      .map(([reason, count]) => reason + " (" + count + ")")
      .join("; ");

    if (!releases.length) {
      return (
        'Lidarr searched for "' +
        album.title +
        '" but its indexers returned no releases. Test the indexer in Lidarr under Settings > Indexers.'
      );
    }

    return (
      "Lidarr found " +
      releases.length +
      " release" +
      (releases.length === 1 ? "" : "s") +
      ' for "' +
      album.title +
      '", but rejected every result' +
      (reasonSummary ? ": " + reasonSummary : ".") +
      " Fix this in Lidarr under Settings > Indexers; test the failing indexer or use another indexer that returns parseable release metadata. Then use Retry now."
    );
  }

  private async albumIsQueued(albumId: number): Promise<boolean> {
    const response = (await this.request(
      "/queue?page=1&pageSize=1000&includeUnknownArtistItems=true&includeArtist=true",
    )) as any;
    const records = Array.isArray(response) ? response : response.records || [];

    return records.some(
      (item: any) => Number(item.albumId || item.album?.id) === albumId,
    );
  }

  async status(id: string, request: RequestRecord) {
    const command: any =
      request.state === "fulfilled"
        ? { status: "completed" }
        : await this.request(`/command/${encodeURIComponent(id)}`);

    if (command.status === "failed") {
      throw new Error(
        "Lidarr command " +
          id +
          " failed" +
          (command.message || command.result
            ? ": " + (command.message || command.result)
            : "."),
      );
    }
    if (command.status !== "completed") return "pending";

    const foreignAlbumId = request.validatedCandidate?.id;
    if (!foreignAlbumId) return "failed";

    const albums = (await this.request(
      "/album?foreignAlbumId=" + encodeURIComponent(foreignAlbumId),
    )) as any[];
    const album = albums.find((item) => item.statistics);
    if (!album) {
      throw new Error(
        'Lidarr did not retain the selected album "' +
          (request.validatedCandidate?.album || foreignAlbumId) +
          '" (' +
          foreignAlbumId +
          ") after the search command completed.",
      );
    }
    const albumQueued = await this.albumIsQueued(Number(album.id));
    if (albumQueued) return "pending";

    const statistics = album.statistics;
    if (
      request.state === "acquiring" &&
      Number(statistics.trackFileCount || 0) <
        Number(statistics.totalTrackCount || 0)
    ) {
      return "queue_deleted";
    }

    if (/0 reports downloaded/i.test(command.message || "")) {
      throw new Error(await this.noDownloadMessage(id, album));
    }

    const validatedTrack = request.validatedCandidate?.track;
    if (validatedTrack && album.id) {
      const tracks = (await this.request(
        "/track?albumId=" + encodeURIComponent(album.id),
      )) as any[];
      const requestedTrack = normalizeTitle(validatedTrack);
      const matchingTrack = tracks.find(
        (track) => normalizeTitle(String(track.title || "")) === requestedTrack,
      );

      if (!matchingTrack) {
        throw new Error(
          'Lidarr album "' +
            album.title +
            '" does not contain the requested track "' +
            validatedTrack +
            '". Select a matching album.',
        );
      }

      if (matchingTrack.hasFile === true) {
        request.validatedCandidate = {
          ...request.validatedCandidate!,
          track: matchingTrack.title,
        };
      }

      return matchingTrack.hasFile === true ? "complete" : "pending";
    }

    return statistics.totalTrackCount > 0 &&
      statistics.trackFileCount >= statistics.totalTrackCount
      ? "complete"
      : "pending";
  }
}
