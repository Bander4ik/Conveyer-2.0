# Conveyer 2.0

Local pipeline platform for producing faceless AI YouTube videos in the style of channels
like [The Sky Lab](https://www.youtube.com/@TheSkyLab-u4j) and
[Interstellar Dreams](https://www.youtube.com/@InterstellarDreams-w5g):
**script → scenes → voiceover + visuals → final MP4**.

> 🚀 **What changed in v2.0:**
> - **Visuals through GeminiGen.AI**: images (`nano-banana-pro` 2K keyframes) and
>   Veo 3.1 video animation through one key. No rate limits on the core models.
>   **69labs is gone entirely.**
> - **Every scene is a Veo clip** by default (no more 50/50 photo+video mix). The
>   image is generated as the keyframe for img2vid. Switch `ANIMATION_PROVIDER`
>   to `off` in `/settings` to fall back to Ken-Burns photos and save credits.
> - **Narration through [algrow.online](https://algrow.online)**: 33+ voices
>   from ElevenLabs + Stealth catalogs with **5-second audio previews** built
>   into `/settings` so you can audition voices before picking one. (GeminiGen's
>   own TTS isn't on their public API yet.)
> - **Max-quality defaults**: nano-banana-pro images, veo-3.1 (full) at 1080p,
>   ElevenLabs voices via Algrow.

> 👋 **Brand new and don't know what npm / Node / API keys are?**
> Read [SETUP.md](./SETUP.md) — a non-technical step-by-step install guide that walks you
> through everything from zero. Come back to this README once you have the platform running.
>
> 🔄 **Already running an older version?** See [UPDATING.md](./UPDATING.md) for step-by-step
> update instructions (ZIP and git, Mac and Windows). Your API keys, prompts, and runs
> are preserved automatically.

Everything is controlled from a local web UI:

- **/** — paste a script and run the pipeline
- **/runs** — history of all runs
- **/runs/[id]** — live status + log stream (SSE)
- **/prompts** — edit the system prompts (scene splitting, image style, motion style)
- **/settings** — API keys, model picks, performance tuning

---

## Quick start

### Prerequisites
- **Node.js 20+** — https://nodejs.org/ (works on macOS, Windows, Linux)
- **FFmpeg** — required for video assembly
  - **macOS:** `brew install ffmpeg` (install Homebrew first from https://brew.sh)
  - **Windows:** `winget install Gyan.FFmpeg` (open a fresh terminal after install)
  - **Linux:** `sudo apt install ffmpeg`
  - Or set `FFMPEG_PATH` in `/settings` to point at the binary directly

### Install + run
```bash
# macOS / Linux: just double-click these
install.command    # one-time, installs npm dependencies
start.command      # daily — starts dev server and opens browser

# Windows: same idea, .bat instead of .command
install.bat
start.bat

# Cross-platform alternative (any OS)
npm install
npm run dev
```

Then open http://localhost:3000.

> **First time on macOS?** When you double-click a `.command` file, macOS Gatekeeper
> may block it. Right-click the file → **Open** → confirm. After that, double-click works
> normally. If you see "Operation not permitted", run `chmod +x *.command` in Terminal first.

### Required keys
Open `/settings`. The top section, **Required API Keys**, shows the three keys you must
provide before anything works:

1. **`GOOGLE_API_KEY`** — Google AI Studio (Gemini) for scene splitting. Free tier is
   plenty. Get one at https://aistudio.google.com/app/apikey
2. **`GEMINIGEN_API_KEY`** — GeminiGen.AI for image keyframes (nano-banana-pro) and
   Veo 3.1 video animation. No per-account rate limits on the core models.
   Sign up at https://geminigen.ai
3. **`ALGROW_API_KEY`** — Algrow.online for TTS narration. 33+ ElevenLabs + Stealth
   voices to pick from with 5-second preview clips. Requires Professional or
   Ultimate plan on Algrow's side. Sign up at https://algrow.online

After pasting the keys:
- Click **🎙 Browse voices** in `/settings` (next to TTS_VOICE_ID).
- Audition voices with the ▶ Preview buttons, click **Select** on the one you want.
- TTS_VOICE_ID / TTS_VOICE_NAME / TTS_VOICE_PROVIDER are filled and saved automatically.

### Quality vs throughput

Defaults are tuned for **maximum quality**, suitable for premium YouTube content:

| Stage | Model (default) | Why | Trade-off |
|---|---|---|---|
| Image | `nano-banana-pro` (Gemini 3 Pro Image) | Professional asset creation, advanced reasoning, high-fidelity text | Rate-limited 5/min on free tier — keep `IMAGE_CONCURRENCY=3` |
| Image res | `2K` | Visibly sharper than 1K, perfect base for 1080p video | Costs more credits |
| Video | `veo-3.1` (full) | Latest top-quality Veo with enhanced capabilities | Slowest, most credits per clip |
| Video res | `1080p` | Matches YouTube HD output | More credits vs 720p |
| TTS | Algrow ElevenLabs (`eleven_multilingual_v2`) | 33+ browseable voices with audio previews | Switch to `stealth` catalog or direct ElevenLabs/OpenAI if needed |

**To trade quality for speed/cost** (e.g. for bulk 20+ scene runs): switch to
`nano-banana-2` (no rate limit), `veo-3.1-fast`, `720p` and raise concurrency
in `/settings → Performance`.

---

## Pipeline architecture

```
script
  │
  ▼
[1] scene_split   (Gemini / Claude → JSON array of scenes)
  │  each scene: { text, visual_prompt, duration_hint_sec }
  ▼
[2] for each scene, in parallel (with concurrency limits):
       ├─ TTS (Algrow ElevenLabs voices) → mp3
       ├─ image (GeminiGen.AI nano-banana-pro) → png (keyframe for img2vid)
       └─ img2vid (GeminiGen.AI Veo 3.1) → mp4 — EVERY scene gets a video clip in v2
  │
  ▼
[3] assemble (FFmpeg) — Veo clip + audio → clip with time-matched length,
    then xfade all clips into final.mp4
```

Every stage logs to the database AND streams to the UI in real time over SSE.

---

## Where files are stored

- **Database** (settings, run records, logs):
  - macOS / Linux: `~/.conveyer-isabell/isabell.db`
  - Windows: `C:\Users\YOU\.conveyer-isabell\isabell.db`
  - ~1 MB
- **Run outputs** (audio, images, animations, clips, final.mp4):
  - default: `~/.conveyer-isabell/runs/<run-folder>/`
  - configurable via `/settings → RUNS_OUTPUT_DIR`

For convenience the project also creates a symlink/junction at `data/runs` inside the
project folder pointing to the actual runs directory, so you can navigate to outputs from
either location.

> **macOS:** the default folder starts with `.` which means Finder hides it. To see it:
> in Finder press **⌘ + Shift + .** (period) to toggle hidden folders, or press
> **⌘ + Shift + G** and paste `~/.conveyer-isabell/runs/`.

---

## Editing the code

Most behavior lives in these files:

| Area | File |
|---|---|
| Scene splitter (Gemini / Claude) | `src/lib/services/scene-split.ts` |
| TTS providers (GeminiGen / ElevenLabs / OpenAI) | `src/lib/services/tts.ts` |
| GeminiGen.AI client (images, video, TTS) | `src/lib/services/geminigen.ts` |
| Image providers (GeminiGen / Replicate / OpenAI / fal) | `src/lib/services/image-gen.ts` |
| img2vid providers (GeminiGen Veo / Kling via Replicate / fal) | `src/lib/services/img2vid.ts` |
| FFmpeg assembly (Ken-Burns, xfade) | `src/lib/services/video-assemble.ts` |
| Pipeline orchestrator | `src/lib/pipeline.ts` |
| Default prompts | `src/lib/prompts.ts` |
| Defaults for `/settings` fields | `src/lib/settings.ts` |

Every stage uses `log(runId, level, message, { stage, data })` — anything you log
shows up in the live UI automatically.

---

## What's next (potential improvements)

- Auto-generated subtitles burned in (Whisper or model-provided SRT).
- Background music with auto-ducking under the narrator.
- Batch mode: list of topics → N full videos overnight.
- Direct upload to YouTube via Data API once a run finishes.
- Keyframe chaining for img2vid (last frame of scene N = first frame of scene N+1) so
  clips visually flow into each other.

---

## Security notes

`~/.conveyer-isabell/isabell.db` stores your API keys in plaintext **locally on your
machine**. The database is never pushed to git (`data/*.db` is in `.gitignore`) and it
lives outside the project tree so it can't accidentally be committed.

If you want multi-user deployment or stricter handling, move the secrets into a real vault.

---

## License

MIT — see [LICENSE](./LICENSE).
