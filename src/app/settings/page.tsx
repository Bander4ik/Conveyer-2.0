"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Algrow voice picker modal
// ─────────────────────────────────────────────────────────────────────────────

interface AlgrowVoice {
  voice_id: string;
  name: string;
  gender?: string | null;
  accent?: string | null;
  age?: string | null;
  language?: string | null;
  use_case?: string | null;
  description?: string | null;
  preview_url?: string | null;
  category?: string | null;
  provider?: string;
}

function VoicePickerModal(props: {
  currentVoiceId: string;
  onClose: () => void;
  onPick: (voice: AlgrowVoice) => void;
}) {
  const [catalog, setCatalog] = useState<"elevenlabs" | "stealth">("elevenlabs");
  const [search, setSearch] = useState("");
  const [gender, setGender] = useState("");
  const [language, setLanguage] = useState("");
  const [accent, setAccent] = useState("");
  const [voices, setVoices] = useState<AlgrowVoice[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const load = useCallback(async (resetPage = false) => {
    setLoading(true);
    setError(null);
    const targetPage = resetPage ? 1 : page;
    const qs = new URLSearchParams({ catalog, page: String(targetPage), page_size: "30" });
    if (search) qs.set("search", search);
    if (gender) qs.set("gender", gender);
    if (language) qs.set("language", language);
    if (accent) qs.set("accent", accent);
    try {
      const r = await fetch(`/api/voices?${qs}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      if (resetPage) {
        setVoices(j.voices || []);
        setPage(1);
      } else {
        setVoices((prev) => (targetPage === 1 ? j.voices || [] : [...prev, ...(j.voices || [])]));
      }
      setHasMore(!!j.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [catalog, search, gender, language, accent, page]);

  // Initial load + reload on catalog change
  useEffect(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [catalog]);

  function playPreview(v: AlgrowVoice) {
    if (!v.preview_url) return;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (playingId === v.voice_id) {
      // toggle stop
      setPlayingId(null);
      return;
    }
    const a = new Audio(v.preview_url);
    audioRef.current = a;
    a.onended = () => setPlayingId(null);
    a.onerror = () => setPlayingId(null);
    a.play().catch(() => setPlayingId(null));
    setPlayingId(v.voice_id);
  }

  function close() {
    if (audioRef.current) audioRef.current.pause();
    props.onClose();
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, padding: 16,
      }}
      onClick={close}
    >
      <div
        className="card"
        style={{
          width: "min(960px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column",
          padding: 0, overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #2a2a3a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Browse voices (Algrow)</h2>
          <button className="btn-secondary" onClick={close}>Close</button>
        </div>

        {/* Catalog tabs */}
        <div style={{ display: "flex", gap: 4, padding: "8px 16px 0", borderBottom: "1px solid #2a2a3a" }}>
          {(["elevenlabs", "stealth"] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setCatalog(cat)}
              style={{
                padding: "8px 16px", border: "none",
                background: catalog === cat ? "#2a2a3a" : "transparent",
                color: catalog === cat ? "#fff" : "#9090a8",
                fontWeight: catalog === cat ? 700 : 500,
                borderRadius: "8px 8px 0 0", cursor: "pointer",
              }}
            >
              {cat === "elevenlabs" ? "ElevenLabs" : "Stealth"}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap", borderBottom: "1px solid #2a2a3a" }}>
          <input
            className="input"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(true)}
            style={{ flex: "1 1 200px", minWidth: 160 }}
          />
          {catalog === "elevenlabs" && (
            <>
              <select className="input" value={gender} onChange={(e) => { setGender(e.target.value); }} style={{ flex: "0 0 120px" }}>
                <option value="">Any gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
              <select className="input" value={language} onChange={(e) => { setLanguage(e.target.value); }} style={{ flex: "0 0 130px" }}>
                <option value="">Any language</option>
                <option value="English">English</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="German">German</option>
                <option value="Italian">Italian</option>
                <option value="Portuguese">Portuguese</option>
                <option value="Ukrainian">Ukrainian</option>
                <option value="Russian">Russian</option>
              </select>
              <select className="input" value={accent} onChange={(e) => { setAccent(e.target.value); }} style={{ flex: "0 0 130px" }}>
                <option value="">Any accent</option>
                <option value="American">American</option>
                <option value="British">British</option>
                <option value="Australian">Australian</option>
              </select>
            </>
          )}
          <button className="btn" onClick={() => load(true)} disabled={loading}>
            {loading ? "Loading…" : "Apply filters"}
          </button>
        </div>

        {/* Voice list */}
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {error && (
            <div style={{ background: "#3a1d1d", border: "1px solid #ff6d6d", color: "#ff8888", padding: 12, borderRadius: 8, marginBottom: 12 }}>
              {error}
            </div>
          )}
          {voices.length === 0 && !loading && !error && (
            <div style={{ color: "#8a8aa0", textAlign: "center", padding: 32 }}>
              No voices found.
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {voices.map((v) => {
              const isCurrent = v.voice_id === props.currentVoiceId;
              const isPlaying = playingId === v.voice_id;
              return (
                <div
                  key={v.voice_id}
                  style={{
                    border: isCurrent ? "2px solid #4caf50" : "1px solid #2a2a3a",
                    borderRadius: 10,
                    padding: 12,
                    background: "#16161e",
                    display: "flex", flexDirection: "column", gap: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{v.name}</div>
                    {isCurrent && <span style={{ fontSize: 10, color: "#4caf50", fontWeight: 700 }}>CURRENT</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11, color: "#8a8aa0" }}>
                    {v.gender && <Tag>{v.gender}</Tag>}
                    {v.accent && <Tag>{v.accent}</Tag>}
                    {v.language && <Tag>{v.language}</Tag>}
                    {v.age && <Tag>{v.age}</Tag>}
                    {v.use_case && <Tag>{v.use_case}</Tag>}
                  </div>
                  {v.description && (
                    <div style={{ fontSize: 12, color: "#a8a8b8", lineHeight: 1.4 }}>{v.description}</div>
                  )}
                  <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
                    <button
                      className="btn-secondary"
                      onClick={() => playPreview(v)}
                      disabled={!v.preview_url}
                      style={{ flex: 1, fontSize: 12 }}
                    >
                      {isPlaying ? "⏸ Stop" : "▶ Preview"}
                    </button>
                    <button
                      className="btn"
                      onClick={() => props.onPick(v)}
                      style={{ flex: 1, fontSize: 12 }}
                    >
                      {isCurrent ? "✓ Selected" : "Select"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {hasMore && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button
                className="btn-secondary"
                disabled={loading}
                onClick={() => { setPage((p) => p + 1); setTimeout(() => load(false), 0); }}
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ background: "#2a2a3a", padding: "2px 6px", borderRadius: 4, fontSize: 10, color: "#b8b8c8" }}>
      {children}
    </span>
  );
}


interface Field {
  key: string;
  label?: string;
  desc: string;
  examples?: string;
  required?: boolean;
}

interface Group {
  title: string;
  subtitle?: string;
  required?: boolean;
  fields: Field[];
}

/**
 * Settings organized by responsibility. Required keys are visually flagged.
 * Each field gets a multi-line description explaining what it does and how it
 * affects pipeline output.
 */
const GROUPS: Group[] = [
  {
    title: "Required API Keys",
    subtitle: "Three keys power the pipeline: Google Gemini for script splitting, GeminiGen.AI for images + Veo video, and Algrow for TTS narration with 33+ voices to choose from.",
    required: true,
    fields: [
      {
        key: "GOOGLE_API_KEY",
        desc: "Powers scene splitting — Gemini reads your script and breaks it into individual scenes with visual prompts.",
        examples: "Get it free at https://aistudio.google.com/app/apikey (Create API key)",
        required: true,
      },
      {
        key: "GEMINIGEN_API_KEY",
        desc: "GeminiGen.AI key for images (nano-banana-pro keyframes) and Veo 3.1 video animation. No per-account rate limit on the core models.",
        examples: "Sign up at https://geminigen.ai → Service Integration → API keys",
        required: true,
      },
      {
        key: "ALGROW_API_KEY",
        desc: "Algrow key for narration. Algrow proxies ElevenLabs + Stealth voices (33+ voices total) under one API and gives 5-second previews of each. Requires a Professional or Ultimate plan on Algrow's side.",
        examples: "Sign up at https://algrow.online → Settings → API Keys → Generate",
        required: true,
      },
    ],
  },
  {
    title: "Storage Location",
    subtitle: "Where the generated audio, images, and final videos are saved on disk.",
    fields: [
      {
        key: "RUNS_OUTPUT_DIR",
        desc: "Absolute folder path for run outputs. Leave empty to use the default location inside your user profile. The settings database itself stays in the default location regardless of this setting.",
        examples: "Mac: /Users/you/Documents/Conveyer-Runs  ·  Windows: D:\\YouTube\\Conveyer-Runs",
      },
      {
        key: "FFMPEG_PATH",
        desc: "Absolute path to the FFmpeg binary. Only needed if FFmpeg is not in your system PATH. The platform requires FFmpeg for video assembly.",
        examples: "Mac: /opt/homebrew/bin/ffmpeg (Apple Silicon) or /usr/local/bin/ffmpeg (Intel)  ·  Windows: C:\\ffmpeg\\bin\\ffmpeg.exe  ·  Leave empty if `ffmpeg` works in your terminal",
      },
    ],
  },
  {
    title: "Script Breakdown (LLM)",
    subtitle: "How your script gets divided into scenes, and which language model does the splitting.",
    fields: [
      {
        key: "SCENE_SPLIT_PROVIDER",
        desc: "Which LLM service splits your script into scenes. Gemini is cheap and fast. Claude is more thorough but costs more.",
        examples: "google  or  anthropic",
      },
      {
        key: "SCENE_SPLIT_MODEL",
        desc: "Specific model id. For Google, the `-latest` alias auto-tracks the current stable Flash. For Anthropic use the full model id.",
        examples: "gemini-flash-latest, gemini-2.5-flash, gemini-2.5-pro, claude-sonnet-4-6",
      },
    ],
  },
  {
    title: "Voice Over (TTS)",
    subtitle: "Algrow.online proxies ElevenLabs + Stealth voices (33+ to pick from). Click 'Browse voices' below to audition 5-second previews and pick one — TTS_VOICE_ID / TTS_VOICE_NAME / TTS_VOICE_PROVIDER are filled automatically.",
    fields: [
      {
        key: "TTS_PROVIDER",
        desc: "Top-level routing. `algrow` (default) goes through algrow.online with browseable voices. `elevenlabs` calls ElevenLabs directly (needs ELEVENLABS_API_KEY). `openai` uses gpt-4o-mini-tts (needs OPENAI_API_KEY).",
        examples: "algrow (default)  /  elevenlabs  /  openai",
      },
      {
        key: "TTS_VOICE_ID",
        desc: "Voice ID. Click the 'Browse voices' button above the field to pick from Algrow's catalog with audio previews. Manual entry is also fine if you know the ID.",
        examples: "(filled automatically by Browse voices)",
      },
      {
        key: "TTS_VOICE_NAME",
        desc: "Human-readable name of the picked voice (for logs and filenames). Auto-filled when you pick via Browse voices.",
        examples: "(auto-filled)",
      },
      {
        key: "TTS_VOICE_PROVIDER",
        desc: "Algrow sub-catalog the voice belongs to. Auto-set when you pick via Browse voices. `elevenlabs` = ElevenLabs voices, `stealth` = Stealth voices (different catalog with its own voices).",
        examples: "elevenlabs (default)  /  stealth",
      },
      {
        key: "TTS_MODEL",
        desc: "ElevenLabs model id (used when the picked voice is in the ElevenLabs catalog). `eleven_multilingual_v2` is the high-quality default. `eleven_flash_v2_5` is faster but slightly less expressive.",
        examples: "eleven_multilingual_v2 (default), eleven_flash_v2_5",
      },
      {
        key: "TTS_STABILITY",
        desc: "ElevenLabs only. How consistent the voice sounds across the whole audio. Higher = more uniform, less variation. Lower = more expressive but can sometimes wobble.",
        examples: "Range 0–1  ·  default 0.6 (balanced for narration)",
      },
      {
        key: "TTS_SIMILARITY_BOOST",
        desc: "ElevenLabs only. How closely the synthesized voice matches the source reference. Higher = more faithful to the original voice's character.",
        examples: "Range 0–1  ·  default 0.75",
      },
      {
        key: "TTS_STYLE",
        desc: "ElevenLabs only. Expressiveness. 0 = calm, even delivery. Higher values inject more emotional inflection. Documentary voices usually sit around 0.1–0.2.",
        examples: "Range 0–1  ·  default 0.15",
      },
      {
        key: "TTS_SPEED",
        desc: "Speech rate. 1.0 = neutral pace. Clamped to ElevenLabs range 0.7–1.2 server-side. Lower = slower, more cinematic narration.",
        examples: "Range 0.7–1.2  ·  default 1.0  ·  0.93 for slow documentary",
      },
    ],
  },
  {
    title: "Images",
    subtitle: "Generates one still image per scene. The same image is then either used directly (Ken-Burns zoom) or as the first frame for an img2vid clip.",
    fields: [
      {
        key: "IMAGE_PROVIDER",
        desc: "Which service generates images. GeminiGen.AI is the default — direct access to Google's Gemini Image models with no per-account rate limit on nano-banana-2. Fallbacks: Replicate (Flux), OpenAI Images, fal.ai.",
        examples: "geminigen (default)  /  replicate  /  openai  /  fal",
      },
      {
        key: "IMAGE_MODEL",
        desc: "Specific model. `nano-banana-pro` (default) = Gemini 3 Pro Image — TOP QUALITY for professional content, advanced reasoning, high-fidelity text rendering. Rate-limited to 5/min on free tier. `nano-banana-2` = Gemini 3 Flash Image — slightly lower quality, NO rate limit (use this if you need 10+ concurrent images). `imagen-4` = great for textures (fur, fabric, water droplets).",
        examples: "nano-banana-pro (max quality, rate-limited), nano-banana-2 (fast, unlimited), imagen-4 (textures)",
      },
      {
        key: "IMAGE_RATIO",
        desc: "Aspect ratio of generated images. 16:9 for landscape YouTube videos, 9:16 for vertical Shorts/Reels, 1:1 for thumbnails.",
        examples: "16:9, 9:16, 1:1, 4:3, 3:4",
      },
      {
        key: "IMAGE_RESOLUTION",
        desc: "Output resolution. 2K (default) is visibly sharper than 1K and worth the extra credits for premium content. 1K is fastest and cheapest. 4K is overkill for 1080p video output — only useful if your final video is 4K.",
        examples: "1K (fast)  /  2K (default, balanced)  /  4K (premium)",
      },
      {
        key: "IMAGE_OUTPUT_FORMAT",
        desc: "PNG keeps lossless quality, JPEG is smaller but slightly degraded. Either works fine for downstream video assembly.",
        examples: "png (default)  /  jpeg",
      },
      {
        key: "IMAGE_STYLE",
        desc: "Optional style preset for GeminiGen images. Photorealistic gives the cleanest base for img2vid animation. Set to empty to skip styling entirely and let the prompt drive everything.",
        examples: "Photorealistic  /  Cinematic  /  Portrait Cinematic  /  Ray Traced  /  empty",
      },
    ],
  },
  {
    title: "Animations (img2vid)",
    subtitle: "Turns each generated image into a Veo video clip. In v2 EVERY scene is animated by default — no static Ken-Burns photos. Set ANIMATION_PROVIDER to `off` to fall back to Ken-Burns photos (much cheaper, no video credits used).",
    fields: [
      {
        key: "ANIMATION_PROVIDER",
        desc: "Service for img2vid. `geminigen` (default) uses Google Veo through GeminiGen.AI — no rate limit. `replicate` uses Kling/WAN, `fal` uses Kling. `off` disables animation entirely and falls back to Ken-Burns photo zoom (cheapest option).",
        examples: "geminigen (default, every scene animated)  /  replicate  /  fal  /  off (photos only)",
      },
      {
        key: "ANIMATION_MODEL",
        desc: "Specific Veo model. `veo-3.1` (default) — TOP QUALITY, latest high-quality Veo with enhanced capabilities, slowest but most cinematic. `veo-3.1-fast` — fast variant with good quality, ideal when running 8+ scenes. `veo-3.1-lite` — generates video with synchronized audio. `veo-2` — legacy, 720p only, flexible duration.",
        examples: "veo-3.1 (max quality), veo-3.1-fast (balanced), veo-3.1-lite (with audio), veo-2 (legacy)",
      },
      {
        key: "ANIMATION_RESOLUTION",
        desc: "Output resolution for Veo clips. 1080p (default) is full HD and matches the standard YouTube output. 720p is faster and cheaper but visibly softer.",
        examples: "720p (fast)  /  1080p (default, full HD)",
      },
      {
        key: "ANIMATION_RATIO_PERCENT",
        desc: "Percentage of scenes to animate. 100 (default in v2) = every scene is a Veo video clip. Lower it (e.g. 50) to mix Veo clips with Ken-Burns photos and save credits.",
        examples: "100 (default, every scene animated)  ·  50 (mix)  ·  0 (photos only)",
      },
      {
        key: "ANIMATION_DISTRIBUTION",
        desc: "Which scenes get picked when ratio < 100. `all` (default) = every scene. `first-half` puts video clips at the start (strong hook), photos at the end. `alternating` interleaves. `random` picks scenes with motion keywords first.",
        examples: "all (default)  /  first-half  /  alternating  /  random",
      },
      {
        key: "ANIMATION_DURATION",
        desc: "Length of each generated clip in seconds. Veo supports 4, 6, or 8 (we snap to nearest). Veo 3.1 always produces 8 seconds and ignores this.",
        examples: "4  /  6  /  8 (default)",
      },
      {
        key: "ANIMATION_KEEP_VEO_AUDIO",
        desc: "Whether to keep ambient audio Veo generates inside each clip. Default empty — we mute it so only the TTS narration is heard. Set `1` if you want Veo's atmospheric sound layered behind the narrator.",
        examples: "empty = mute  ·  1 = keep ambient audio",
      },
    ],
  },
  {
    title: "Video Assembly (FFmpeg)",
    subtitle: "Final stitching step. Controls output resolution, framerate, and how scenes transition into each other.",
    fields: [
      {
        key: "VIDEO_RESOLUTION",
        desc: "Final video resolution. 1920x1080 (1080p) is the YouTube standard. 1280x720 (720p) is smaller files but lower quality. Veo source clips are upscaled/downscaled to fit.",
        examples: "1920x1080, 1280x720, 3840x2160",
      },
      {
        key: "VIDEO_FPS",
        desc: "Frames per second. 24 is cinematic feel. 30 is YouTube standard. 60 is smoother motion but doubles render time and file size.",
        examples: "24, 30, 60",
      },
      {
        key: "SCENE_DURATION_SECONDS",
        desc: "Fallback clip duration when TTS audio length is somehow unknown. In normal operation this is never used because we measure actual audio length with ffprobe.",
        examples: "default 5",
      },
      {
        key: "TRANSITION_DURATION",
        desc: "Crossfade length between scenes in seconds. 0.5 is a gentle blend. 1.0 is more cinematic. 0 disables transitions (instant cuts — much faster to render but looks abrupt).",
        examples: "0.5 = smooth  ·  1.0 = cinematic  ·  0 = no transitions",
      },
      {
        key: "SCENE_TAIL_SILENCE",
        desc: "Silence appended to the END of every scene's audio before assembly. This is how you get natural breathing room BETWEEN scenes — each scene is a separate TTS call, so without this setting scenes get stitched back-to-back with no pause. Raise to 0.6–0.8 if the narration still feels rushed at sentence endings.",
        examples: "0 = no padding (back-to-back)  ·  0.4 = natural breath (default)  ·  0.8 = reflective pacing",
      },
    ],
  },
  {
    title: "Performance (Concurrency)",
    subtitle: "How many parallel API jobs and FFmpeg renders to run at once. Higher = faster, but rate-limited models (nano-banana-pro free tier ~5/min) need caution.",
    fields: [
      {
        key: "IMAGE_CONCURRENCY",
        desc: "Simultaneous image generation jobs. With `nano-banana-pro` (default, max quality) free tier limits you to ~5/min so keep this at 3. With `nano-banana-2` there's NO rate limit — raise to 15–20+ for high-throughput batch runs.",
        examples: "3 (default, nano-banana-pro safe)  ·  15+ if you switch to nano-banana-2",
      },
      {
        key: "TTS_CONCURRENCY",
        desc: "Simultaneous TTS jobs through GeminiGen Gemini TTS. No documented rate limit on tts-flash — raise as high as your network/CPU allows.",
        examples: "default 3  ·  bump to 5–7 for long scripts (no API-side cap)",
      },
      {
        key: "ANIMATION_CONCURRENCY",
        desc: "Simultaneous Veo img2vid jobs through GeminiGen.AI. Default 2 because veo-3.1 (full, max quality) is slow and each clip burns credits. Bump to 4–6 if you switch to veo-3.1-fast.",
        examples: "default 3  ·  raise to 5–10 if credits allow",
      },
      {
        key: "ASSEMBLE_CONCURRENCY",
        desc: "How many FFmpeg clip renders happen in parallel. This is CPU-bound — set roughly to half your CPU core count. A 16-core machine can comfortably handle 6–8.",
        examples: "default 4  ·  raise on 8+ core CPUs",
      },
      {
        key: "ASSEMBLE_XFADE_CHUNKS",
        desc: "Splits the final crossfade pass into N chunks that run in parallel, then crossfades the chunks together. Massively speeds up assembly for long videos (100+ scenes) because FFmpeg's xfade filter is single-threaded per pair. With 4 chunks, a 100-scene xfade on an 8-core CPU drops from ~50 min to ~12-15 min. Set to 1 to disable (monolithic xfade). Auto-skipped if you have fewer than 3×chunks scenes (i.e. 12 with default 4).",
        examples: "1 = no chunking  ·  4 = default (4-8 core CPU)  ·  6-8 for 16+ core CPUs",
      },
    ],
  },
  {
    title: "Optional / Alternative Providers",
    subtitle: "Backup providers. Leave empty if you're using the default GeminiGen.AI stack — these are only needed if you want ElevenLabs voices, Replicate/fal alternatives, or Claude for scene splitting.",
    fields: [
      {
        key: "ELEVENLABS_API_KEY",
        desc: "Direct ElevenLabs API key. Only used when TTS_PROVIDER is set to `elevenlabs`. Useful if you have a specific ElevenLabs voice you prefer over Gemini TTS.",
        examples: "Sign up at https://elevenlabs.io → Profile → API Keys",
      },
      {
        key: "REPLICATE_API_TOKEN",
        desc: "Replicate token, for using Flux Schnell (images) or Kling/WAN (img2vid) as alternatives to GeminiGen. Pay-as-you-go pricing.",
        examples: "Sign up at https://replicate.com → Account → API Tokens",
      },
      {
        key: "FAL_API_KEY",
        desc: "fal.ai key — alternative to Replicate. Faster cold starts in some cases.",
        examples: "Sign up at https://fal.ai → API keys",
      },
      {
        key: "ANTHROPIC_API_KEY",
        desc: "Anthropic Claude key. Only used when SCENE_SPLIT_PROVIDER is `anthropic`. Claude is more thorough than Gemini Flash but costs more.",
        examples: "Sign up at https://console.anthropic.com",
      },
      {
        key: "OPENAI_API_KEY",
        desc: "OpenAI key — for backup TTS (gpt-4o-mini-tts) or gpt-image-2 images.",
        examples: "Sign up at https://platform.openai.com",
      },
    ],
  },
];

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function load(reveal = false) {
    const r = await fetch(`/api/settings${reveal ? "?reveal=1" : ""}`);
    setValues(await r.json());
    setRevealing(reveal);
  }

  useEffect(() => { load(false); }, []);

  async function save() {
    // Drop fields whose value is still the masked placeholder ("AIza…XXXX").
    // Sending those back overwrites the real key in the DB with a broken
    // string containing U+2026 — which then crashes every downstream API
    // call (fetch refuses to put non-ASCII chars in headers).
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      const isSecret = k.includes("KEY") || k.includes("TOKEN");
      if (isSecret && typeof v === "string" && v.includes("…")) continue;
      cleaned[k] = v;
    }
    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cleaned),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({} as { error?: string }));
      alert(`Save failed: ${j.error || r.statusText}`);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    load(revealing);
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Keys &amp; Settings</h1>
      <p style={{ color: "#8a8aa0", marginBottom: 16, lineHeight: 1.6 }}>
        Everything is stored locally in SQLite. Empty fields fall back to the matching environment
        variable (see <code>.env.example</code>). Secret keys are masked by default — toggle the
        button below to edit them.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, position: "sticky", top: 0, background: "var(--bg)", padding: "8px 0", zIndex: 10 }}>
        <button className="btn-secondary" onClick={() => load(!revealing)}>
          {revealing ? "Hide secret values" : "Reveal secret values (to edit)"}
        </button>
        <button className="btn" onClick={save}>{saved ? "Saved ✓" : "Save all changes"}</button>
      </div>

      {GROUPS.map((g) => (
        <div
          key={g.title}
          className="card"
          style={{
            marginBottom: 14,
            borderColor: g.required ? "#ff6d6d" : undefined,
            borderWidth: g.required ? 2 : 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <h3 style={{ fontWeight: 700, fontSize: 16 }}>{g.title}</h3>
            {g.required && (
              <span
                style={{
                  background: "#3a1d1d",
                  color: "#ff6d6d",
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}
              >
                REQUIRED
              </span>
            )}
          </div>
          {g.subtitle && (
            <p style={{ color: "#8a8aa0", fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
              {g.subtitle}
            </p>
          )}
          <div style={{ display: "grid", gap: 14 }}>
            {g.fields.map((f) => (
              <div key={f.key}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                  <label
                    className="label"
                    style={{
                      margin: 0,
                      color: f.required ? "#ff8888" : "#b8b8c8",
                      fontWeight: 600,
                      fontSize: 12,
                      letterSpacing: 0.3,
                    }}
                  >
                    {f.key}
                  </label>
                  {f.required && (
                    <span style={{ color: "#ff6d6d", fontSize: 10, fontWeight: 700 }}>required</span>
                  )}
                </div>
                {f.key === "TTS_VOICE_ID" ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      className="input"
                      value={values[f.key] ?? ""}
                      placeholder="(pick via Browse voices)"
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      style={{
                        flex: 1,
                        borderColor: f.required && !values[f.key] ? "#ff6d6d" : undefined,
                      }}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setPickerOpen(true)}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      🎙 Browse voices
                    </button>
                  </div>
                ) : (
                  <input
                    className="input"
                    value={values[f.key] ?? ""}
                    placeholder={f.examples ? `e.g. ${f.examples}` : ""}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    style={{
                      borderColor: f.required && !values[f.key] ? "#ff6d6d" : undefined,
                    }}
                  />
                )}
                <div
                  style={{
                    color: "#9090a8",
                    fontSize: 12,
                    marginTop: 6,
                    lineHeight: 1.5,
                  }}
                >
                  {f.desc}
                </div>
                {f.examples && (
                  <div style={{ color: "#5a5a70", fontSize: 11, marginTop: 4, fontFamily: "ui-monospace, monospace" }}>
                    {f.examples}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {pickerOpen && (
        <VoicePickerModal
          currentVoiceId={values.TTS_VOICE_ID || ""}
          onClose={() => setPickerOpen(false)}
          onPick={async (voice) => {
            // Set all three correlated fields at once. Save them via the
            // settings API directly so the picker also works without the
            // user remembering to click "Save all changes".
            const next = {
              ...values,
              TTS_VOICE_ID: voice.voice_id,
              TTS_VOICE_NAME: voice.name,
              TTS_VOICE_PROVIDER: voice.provider || "elevenlabs",
            };
            setValues(next);
            // Persist immediately (filter masked secret values just like save())
            const cleaned: Record<string, string> = {};
            for (const [k, v] of Object.entries(next)) {
              const isSecret = k.includes("KEY") || k.includes("TOKEN");
              if (isSecret && typeof v === "string" && v.includes("…")) continue;
              cleaned[k] = v;
            }
            await fetch("/api/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(cleaned),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
