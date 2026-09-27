import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
type R = {
  id: string;
  artist?: string;
  track?: string;
  album?: string;
  state: string;
  candidates: {
    id: string;
    artist?: string;
    track?: string;
    album?: string;
    year?: number;
    encoding?: string;
  }[];
  validatedArtist?: string;
  validatedTrack?: string;
  validatedAlbum?: string;
  validatedYear?: number;
  validatedCandidate?: {
    id: string;
    artist?: string;
    track?: string;
    album?: string;
    year?: number;
    encoding?: string;
  };
  selectedCandidate?: {
    id: string;
    artist?: string;
    track?: string;
    album?: string;
    year?: number;
    encoding?: string;
  };
  error?: string;
  nextAttemptAt?: string;
};

function retryLabel(nextAttemptAt?: string) {
  if (!nextAttemptAt) return undefined;
  const retryAt = Date.parse(nextAttemptAt.replace(" ", "T") + "Z");
  if (Number.isNaN(retryAt)) return undefined;
  const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  if (seconds <= 0) return "Retrying now";
  if (seconds < 60) return "Retrying in " + seconds + "s";
  return "Retrying in " + Math.ceil(seconds / 60) + "m";
}

function displayAlbum(album?: string, year?: number): string | undefined {
  if (!album) return undefined;
  return album + (year ? " (" + year + ")" : "");
}

function requestLabel(request: R) {
  const candidate = request.validatedCandidate;
  if (candidate) {
    return [
      candidate.track,
      displayAlbum(candidate.album, candidate.year),
      candidate.artist,
    ]
      .filter(Boolean)
      .join(" — ");
  }

  return [
    request.validatedTrack ?? request.track,
    displayAlbum(
      request.validatedAlbum ?? request.album,
      request.validatedYear,
    ),
    request.validatedArtist ?? request.artist,
  ]
    .filter(Boolean)
    .join(" — ");
}

function App() {
  const [rows, setRows] = useState<R[]>([]);
  const [form, setForm] = useState({
    track: "",
    album: "",
    artist: "",
    preferredEncoding: "FLAC",
  });

  const load = () =>
    fetch("/api/requests")
      .then((r) => r.json())
      .then(setRows);
  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (r.ok) {
      setForm({ ...form, track: "", album: "", artist: "" });
      load();
    } else alert((await r.json()).error);
  }

  async function retry(id: string) {
    await fetch("/api/requests/" + id + "/retry", { method: "POST" });
    load();
  }

  async function remove(id: string) {
    await fetch("/api/requests/" + id, { method: "DELETE" });
    load();
  }

  async function choose(id: string, candidateId: string) {
    await fetch(`/api/requests/${id}/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId }),
    });
    load();
  }

  return (
    <main>
      <header>
        <p className="eyebrow">SONGARR</p>
        <h1>
          Ask for music.
          <br />
          <em>Keep it simple.</em>
        </h1>
        <p className="intro">
          Songarr resolves partial requests and hands acquisition to Lidarr.
        </p>
      </header>
      <section className="card">
        <h2>New request</h2>
        <form onSubmit={submit}>
          <input
            placeholder="Song / track"
            value={form.track}
            onChange={(e) => setForm({ ...form, track: e.target.value })}
          />
          <input
            placeholder="Album"
            value={form.album}
            onChange={(e) => setForm({ ...form, album: e.target.value })}
          />
          <input
            placeholder="Artist"
            value={form.artist}
            onChange={(e) => setForm({ ...form, artist: e.target.value })}
          />
          <select
            value={form.preferredEncoding}
            onChange={(e) =>
              setForm({ ...form, preferredEncoding: e.target.value })
            }
          >
            <option>FLAC</option>
            <option>ALAC</option>
            <option>MP3</option>
            <option>AAC</option>
          </select>
          <button>Submit request</button>
        </form>
      </section>
      <section>
        <div className="section-title">
          <h2>Request queue</h2>
          <button className="quiet" onClick={load}>
            Refresh
          </button>
        </div>
        {rows.map((r) => (
          <article className="request" key={r.id}>
            <div>
              <strong>{requestLabel(r)}</strong>
              <small>{r.id}</small>
            </div>
            <div className="request-actions">
              <span className={`status ${r.state}`}>
                {r.state.replace("_", " ")}
              </span>
              {(r.error || r.state === "fulfilled") && (
                <button className="retry-now" onClick={() => retry(r.id)}>
                  Retry now
                </button>
              )}
              <button className="delete" onClick={() => remove(r.id)}>
                Delete
              </button>
            </div>
            {r.error && (
              <details className="reason">
                <summary>Why did this fail?</summary>
                <pre>{r.error}</pre>
              </details>
            )}
            {r.nextAttemptAt && (
              <p className="retry">{retryLabel(r.nextAttemptAt)}</p>
            )}
            {r.state === "needs_selection" && (
              <div className="choices">
                {[...r.candidates]
                  .filter(
                    (candidate) =>
                      candidate.year !== undefined && candidate.year >= 1000,
                  )
                  .sort(
                    (a, b) =>
                      (a.artist || "").localeCompare(b.artist || "") ||
                      (a.year ?? Infinity) - (b.year ?? Infinity) ||
                      (a.album || "").localeCompare(b.album || ""),
                  )
                  .map((c) => (
                    <button key={c.id} onClick={() => choose(r.id, c.id)}>
                      {[c.artist, displayAlbum(c.album, c.year)]
                        .filter(Boolean)
                        .join(" — ")}
                      {c.encoding && <small>{c.encoding}</small>}
                    </button>
                  ))}
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
