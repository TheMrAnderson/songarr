export interface IMusicServer {
  check(): Promise<boolean>;
  refresh(): Promise<void>;
}
