import type { IMusicServer } from "./IMusicServer.js";

export class PassiveMusicServer implements IMusicServer {
  async check() {
    return true;
  }

  async refresh() {}
}
