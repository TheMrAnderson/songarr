import { afterEach, describe, expect, it, vi } from "vitest";
import { MusicBrainzTrackMetadataProvider } from "./MusicBrainzTrackMetadataProvider.js";

afterEach(() => vi.unstubAllGlobals());

describe("MusicBrainz track metadata", () => {
  it("continues through result pages to find exact recordings", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const offset = new URL(input).searchParams.get("offset");
      const recording = {
        title: "Hurt",
        "artist-credit": [{ name: "Johnny Cash" }],
        releases: [
          {
            title: "American IV: The Man Comes Around",
            date: "2002-11-05",
            "release-group": {
              id: "johnny-cash-release-group",
              title: "American IV: The Man Comes Around",
            },
          },
        ],
      };
      return {
        ok: true,
        json: async () => ({
          count: 101,
          recordings:
            offset === "0"
              ? Array.from({ length: 100 }, () => ({ title: "Other" }))
              : [recording],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new MusicBrainzTrackMetadataProvider();
    const metadata = await provider.lookup({
      id: "request-1",
      track: "hurt",
      state: "received",
      candidates: [],
      createdAt: "",
      updatedAt: "",
    });

    expect(metadata.releaseGroupIds).toContain("johnny-cash-release-group");
    expect(metadata.releases?.[0].artist).toBe("Johnny Cash");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

it("retries a transient MusicBrainz 503", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        count: 1,
        recordings: [
          {
            title: "Hurt",
            "artist-credit": [{ name: "Johnny Cash" }],
            releases: [],
          },
        ],
      }),
    });
  vi.stubGlobal("fetch", fetchMock);

  const provider = new MusicBrainzTrackMetadataProvider();
  const metadata = await provider.lookup({
    id: "request-2",
    track: "hurt",
    state: "received",
    candidates: [],
    createdAt: "",
    updatedAt: "",
  });

  expect(metadata.trackTitle).toBe("Hurt");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
