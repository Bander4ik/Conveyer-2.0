"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

// Rough estimate: TTS narration averages ~150 words per minute
const WORDS_PER_MINUTE = 150;

export default function NewRunPage() {
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const stats = useMemo(() => {
    const text = script.trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = text.length;
    const seconds = (words / WORDS_PER_MINUTE) * 60;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return {
      words,
      chars,
      duration: words === 0 ? "—" : (m > 0 ? `~${m} min ${s} s` : `~${s} s`),
      scenes: Math.max(1, Math.round(seconds / 5)), // ~5 sec per scene
    };
  }, [script]);

  async function start() {
    setBusy(true);
    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, script }),
      });
      if (!r.ok) {
        alert(`Error: ${await r.text()}`);
        return;
      }
      const data = (await r.json()) as { id: string };
      router.push(`/runs/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>New run</h1>
      <p style={{ color: "#8a8aa0", marginBottom: 16 }}>
        Paste a script — the system will split it into scenes, generate voiceover and imagery for
        each, then assemble the final video.
      </p>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div>
          <label className="label">Title (optional)</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Solar Storm Test 1"
          />
        </div>
        <div>
          <label className="label">Script</label>
          <textarea
            className="textarea"
            rows={14}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Paste the full script here..."
          />
          <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 13, color: "#8a8aa0" }}>
            <span><strong style={{ color: "#e8e8f0" }}>{stats.words}</strong> words</span>
            <span><strong style={{ color: "#e8e8f0" }}>{stats.chars}</strong> chars</span>
            <span>≈ <strong style={{ color: "#7c5cff" }}>{stats.duration}</strong> of final video</span>
            <span>≈ <strong style={{ color: "#e8e8f0" }}>{stats.scenes}</strong> scenes</span>
          </div>
        </div>
        <div>
          <button className="btn" onClick={start} disabled={busy || !script.trim()}>
            {busy ? "Starting..." : "Run pipeline"}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ fontWeight: 700, marginBottom: 8 }}>What happens next</h3>
        <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Gemini splits the script into scenes (with visual prompts per scene).</li>
          <li>For each scene, TTS narration and an image are generated in parallel.</li>
          <li>Selected scenes get a Veo img2vid clip on top of the still image.</li>
          <li>FFmpeg stitches all clips together with crossfade transitions.</li>
        </ol>
        <p style={{ color: "#8a8aa0", fontSize: 13, marginTop: 8 }}>
          Live logs for every stage stream into the run page in real time.
        </p>
      </div>
    </div>
  );
}
