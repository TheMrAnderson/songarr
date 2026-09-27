import type { IMusicServer } from "./IMusicServer.js";

export class PlexMusicServer implements IMusicServer {
  constructor(
    private baseUrl: string,
    private token?: string,
  ) {}

  async check() {
    const r = await fetch(`${this.baseUrl}/identity`, {
      headers: this.token ? { "X-Plex-Token": this.token } : {},
    });
    return r.ok;
  }

  async refresh() {}
}
