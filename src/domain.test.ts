import { MusicBrainzTrackMetadataProvider } from "./trackmetadata/MusicBrainzTrackMetadataProvider.js";
import { describe, expect, it } from "vitest";
import { validateIntent } from "./domain.js";

describe("request validation", () => {
  it("accepts partial intent", () =>
    expect(validateIntent({ track: "Hurt" }).value).toEqual({ track: "Hurt" }));
  it("rejects empty intent", () =>
    expect(validateIntent({}).error).toMatch(/at least one/i));
  it("rejects non-string fields", () =>
    expect(validateIntent({ track: 4 }).error).toMatch(/track/));
});

describe("complete request options", () => {
  it("accepts and preserves every request field", () => {
    expect(
      validateIntent({
        artist: "Frank Sinatra",
        track: "Fly Me to the Moon",
        album: "It Might as Well Be Swing",
        playlist: "Late Night",
        preferredEncoding: "FLAC",
        clientRequestId: "phone-01",
      }).value,
    ).toEqual({
      artist: "Frank Sinatra",
      track: "Fly Me to the Moon",
      album: "It Might as Well Be Swing",
      playlist: "Late Night",
      preferredEncoding: "FLAC",
      clientRequestId: "phone-01",
    });
  });

  it.each([
    { artist: "Frank Sinatra" },
    { track: "Fly Me to the Moon" },
    { album: "It Might as Well Be Swing" },
    { artist: "Frank Sinatra", album: "It Might as Well Be Swing" },
    { artist: "Frank Sinatra", track: "Fly Me to the Moon" },
  ])("accepts meaningful partial request %#", (request) => {
    expect(validateIntent(request).error).toBeUndefined();
  });
});

describe("MusicBrainz advanced queries", () => {
  it.each([
    {
      name: "song only",
      request: { track: "Fly Me to the Moon" },
      included: ['recording:"Fly Me to the Moon"'],
      omitted: ["artist:", "release:"],
    },
    {
      name: "song and artist",
      request: { artist: "Frank Sinatra", track: "Fly Me to the Moon" },
      included: ['artist:"Frank Sinatra"', 'recording:"Fly Me to the Moon"'],
      omitted: ["release:"],
    },
    {
      name: "song, artist, and album",
      request: {
        artist: "Frank Sinatra",
        album: "Come Fly With Me",
        track: "Fly Me to the Moon",
      },
      included: [
        'artist:"Frank Sinatra"',
        'release:"Come Fly With Me"',
        'recording:"Fly Me to the Moon"',
      ],
      omitted: [],
    },
    {
      name: "album only",
      request: { album: "Come Fly With Me" },
      included: ['release:"Come Fly With Me"'],
      omitted: ["artist:", "recording:"],
    },
    {
      name: "artist only",
      request: { artist: "Frank Sinatra" },
      included: ['artist:"Frank Sinatra"'],
      omitted: ["release:", "recording:"],
    },
  ])("uses the supplied fields for ", ({ request, included, omitted }) => {
    const query = new MusicBrainzTrackMetadataProvider().buildQuery(request);

    for (const clause of included) expect(query).toContain(clause);
    for (const clause of omitted) expect(query).not.toContain(clause);
    expect(query).toContain("status:official");
  });
});
