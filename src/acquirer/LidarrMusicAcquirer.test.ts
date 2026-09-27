import { afterEach, describe, expect, it, vi } from "vitest";
import type { Intent, RequestRecord } from "../domain.js";
import { CombinedTrackMetadataProvider } from "../trackmetadata/CombinedTrackMetadataProvider.js";
import type { ITrackMetadataProvider } from "../trackmetadata/ITrackMetadataProvider.js";
import { LidarrMusicAcquirer } from "./LidarrMusicAcquirer.js";

const requestFor = (intent: Intent): RequestRecord => ({
  id: "request-1",
  state: "resolving",
  candidates: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...intent,
});

const results = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    foreignAlbumId: "album-" + (index + 1),
    title: "Album " + (index + 1),
    releaseDate: 1958 + index + "-01-01",
    artist: { artistName: "Frank Sinatra" },
  }));

afterEach(() => vi.unstubAllGlobals());

describe("Lidarr request resolution", () => {
  it.each([
    [
      "artist only",
      { artist: "Frank Sinatra" },
      "Frank Sinatra",
      2,
      "identity",
    ],
    [
      "album only",
      { album: "Come Fly With Me" },
      "Come Fly With Me",
      1,
      "release",
    ],
    [
      "song only",
      { track: "Fly Me to the Moon" },
      "Fly Me to the Moon",
      2,
      "identity",
    ],
    [
      "artist and album",
      { artist: "Frank Sinatra", album: "Come Fly With Me" },
      "Frank Sinatra - Come Fly With Me",
      1,
      "release",
    ],
    [
      "artist and song",
      { artist: "Frank Sinatra", track: "Fly Me to the Moon" },
      "Frank Sinatra - Fly Me to the Moon",
      2,
      "identity",
    ],
    [
      "album and song",
      { album: "Come Fly With Me", track: "Fly Me to the Moon" },
      "Come Fly With Me - Fly Me to the Moon",
      1,
      "release",
    ],
    [
      "artist, album, and song",
      {
        artist: "Frank Sinatra",
        album: "Come Fly With Me",
        track: "Fly Me to the Moon",
      },
      "Frank Sinatra - Come Fly With Me - Fly Me to the Moon",
      1,
      "release",
    ],
  ])(
    "uses metadata and produces the right stage for %s",
    async (_name, intent, term, resultCount, stage) => {
      const musicBrainzLookup = vi.fn(async () => ({
        releaseGroupIds: Array.from(
          { length: "track" in intent ? (resultCount as number) : 0 },
          (_, index) => "album-" + (index + 1),
        ),
        albumTitles: [],
        trackTitle: "Fly Me to the Moon",
      }));
      const lastFmLookup = vi.fn(async () => ({
        releaseGroupIds: [],
        albumTitles: [],
      }));
      const metadata = new CombinedTrackMetadataProvider([
        { lookup: musicBrainzLookup } as ITrackMetadataProvider,
        { lookup: lastFmLookup } as ITrackMetadataProvider,
      ]);
      const fetchMock = vi.fn((input: string) => {
        const termValue = new URL(input).searchParams.get("term") || "";
        const body = termValue.startsWith("lidarr:")
          ? [
              {
                foreignAlbumId: termValue.slice("lidarr:".length),
                title: "Verified album",
                releaseDate: "1958-01-01",
                artist: { artistName: "Frank Sinatra" },
              },
            ]
          : results(resultCount as number);
        return Promise.resolve({ ok: true, json: async () => body });
      });
      vi.stubGlobal("fetch", fetchMock);
      const request = requestFor(intent as Intent);
      const resolved = await new LidarrMusicAcquirer(
        "http://lidarr.test",
        "api-key",
        metadata,
      ).resolve(request);

      if ("track" in intent) {
        expect(musicBrainzLookup).toHaveBeenCalledWith(request);
        expect(lastFmLookup).toHaveBeenCalledWith(request);
        expect(fetchMock).toHaveBeenCalledTimes(resultCount);
        expect(
          fetchMock.mock.calls.map((call) =>
            new URL(call[0]).searchParams.get("term"),
          ),
        ).toEqual(
          Array.from(
            { length: resultCount },
            (_, index) => "lidarr:album-" + (index + 1),
          ),
        );
      } else {
        expect(musicBrainzLookup).not.toHaveBeenCalled();
        expect(lastFmLookup).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(
          new URL(fetchMock.mock.calls[0][0]).searchParams.get("term"),
        ).toBe(term);
      }
      expect(resolved.candidates).toHaveLength(resultCount);
      if ("track" in intent) {
        expect(
          resolved.candidates.every(
            (candidate) => candidate.track === "Fly Me to the Moon",
          ),
        ).toBe(true);
      }
      expect(resolved.stage).toBe(stage);
    },
  );

  it("rejects a Various Artists album for a named artist", async () => {
    const fetchMock = vi.fn(async (input: string) => ({
      ok: true,
      json: async () =>
        new URL(input).searchParams.get("term") === "lidarr:album-1"
          ? [
              {
                foreignAlbumId: "album-1",
                title: "100 Movie Hits",
                releaseDate: "2009-01-01",
                artist: { artistName: "Various Artists" },
              },
            ]
          : [],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const metadata = {
      lookup: async () => ({
        releaseGroupIds: ["album-1"],
        albumTitles: [],
        trackTitle: "Hound Dog",
      }),
    } as ITrackMetadataProvider;

    await expect(
      new LidarrMusicAcquirer(
        "http://lidarr.test",
        "api-key",
        metadata,
      ).resolve(requestFor({ artist: "Elvis", track: "hound dog" })),
    ).rejects.toThrow(/no verified album/i);
  });

  it("does not contact Lidarr without a canonical track title", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const metadata = {
      lookup: async () => ({ releaseGroupIds: ["album-1"], albumTitles: [] }),
    } as ITrackMetadataProvider;

    await expect(
      new LidarrMusicAcquirer(
        "http://lidarr.test",
        "api-key",
        metadata,
      ).resolve(requestFor({ track: "fly me to the moon" })),
    ).rejects.toThrow(/canonical track title/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it("accepts a canonical artist name when the request uses a shorter name", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          foreignAlbumId: "album-1",
          title: "Hound Dog",
          releaseDate: "1956-01-01",
          artist: { artistName: "Elvis Presley" },
        },
      ],
    })),
  );

  const metadata = {
    lookup: async () => ({
      releaseGroupIds: ["album-1"],
      albumTitles: [],
      trackTitle: "Hound Dog",
      releases: [
        { id: "group-1", artist: "Elvis Presley", title: "Hound Dog" },
      ],
    }),
  } as ITrackMetadataProvider;

  const resolved = await new LidarrMusicAcquirer(
    "http://lidarr.test",
    "api-key",
    metadata,
  ).resolve(requestFor({ artist: "elvis", track: "hound dog" }));

  expect(resolved.candidates).toHaveLength(1);
  expect(resolved.candidates[0].artist).toBe("Elvis Presley");
});

it("detects when a selected album is removed from Lidarr's queue", async () => {
  let queueChecks = 0;
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/command/123")) {
      return {
        ok: true,
        json: async () => ({
          status: "completed",
          message: "Album search completed. 0 reports downloaded.",
        }),
      };
    }
    if (url.pathname.endsWith("/album")) {
      return {
        ok: true,
        json: async () => [
          {
            id: 42,
            title: "Bluebird",
            statistics: { totalTrackCount: 1, trackFileCount: 0 },
          },
        ],
      };
    }
    if (url.pathname.endsWith("/queue")) {
      queueChecks += 1;
      return {
        ok: true,
        json: async () =>
          queueChecks === 1 ? { records: [{ albumId: 42 }] } : { records: [] },
      };
    }
    return { ok: true, json: async () => [] };
  });
  vi.stubGlobal("fetch", fetchMock);

  const request = requestFor({ artist: "Miranda Lambert", track: "Bluebird" });
  request.validatedCandidate = {
    id: "album-1",
    artist: "Miranda Lambert",
    album: "Bluebird",
    track: "Bluebird",
  };

  const acquirer = new LidarrMusicAcquirer("http://lidarr.test", "api-key", {
    lookup: async () => ({ releaseGroupIds: [], albumTitles: [] }),
  });

  await expect(acquirer.status("123", request)).resolves.toBe("pending");
  request.state = "acquiring";
  await expect(acquirer.status("123", request)).resolves.toBe("queue_deleted");
});

it("does not present a Lidarr lookup result for the wrong release group", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          foreignAlbumId: "different-release-group",
          title: "Wrong Album",
          artist: { artistName: "Artist" },
        },
      ],
    })),
  );

  const metadata = {
    lookup: async () => ({
      releaseGroupIds: ["requested-release-group"],
      albumTitles: [],
      trackTitle: "Song",
      releases: [{ id: "requested-release-group", artist: "Artist" }],
    }),
  } as ITrackMetadataProvider;

  await expect(
    new LidarrMusicAcquirer("http://lidarr.test", "api-key", metadata).resolve(
      requestFor({ artist: "Artist", track: "Song" }),
    ),
  ).rejects.toThrow(/no verified album/i);
});
