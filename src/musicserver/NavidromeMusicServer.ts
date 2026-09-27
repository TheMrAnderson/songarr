import type { IMusicServer } from "./IMusicServer.js";

export class NavidromeMusicServer implements IMusicServer {
  constructor(
    private baseUrl: string,
    private token?: string,
  ) {}

  async check() {
    const r = await fetch(`${this.baseUrl}/ping`, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    return r.ok;
  }

  async refresh() {}
}
