"use client";
import { useEffect, useState } from "react";

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
    subtitle: "Two keys are needed to run the pipeline. GeminiGen.AI handles images, video animation AND voice narration — no per-account rate limits on its core models.",
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
        desc: "GeminiGen.AI key for images (nano-banana-2), video animation (Veo) AND text-to-speech (Gemini TTS). One key powers the entire generation phase with no per-account rate limit.",
        examples: "Sign up at https://geminigen.ai → Service Integration → API keys",
        required: true,
      },
    ],
  },
  {
    title: "Optional / Fallback Providers",
    subtitle: "Only needed if you want alternative TTS or image providers. The default pipeline uses GeminiGen.AI for everything.",
    fields: [
      {
        key: "LABS69_API_KEY",
        desc: "Optional — 69labs.vip gateway for ElevenLabs voices. Use this only if you prefer an ElevenLabs voice over Gemini TTS and want to switch TTS_PROVIDER to `69labs` below.",
        examples: "Sign up at https://69labs.vip → Account → API keys. Starts with vk_",
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
    subtitle: "Picks the narrator voice and which TTS service generates the audio. Default is GeminiGen.AI (Gemini TTS) — same key as images/video, 400+ voices, no rate limit.",
    fields: [
      {
        key: "TTS_PROVIDER",
        desc: "Top-level routing of TTS jobs. `geminigen` (default) uses Gemini TTS through your GEMINIGEN_API_KEY. `69labs` routes through 69labs's ElevenLabs gateway (needs LABS69_API_KEY). `elevenlabs` calls ElevenLabs directly. `openai` uses gpt-4o-mini-tts.",
        examples: "geminigen (default)  /  69labs  /  elevenlabs  /  openai",
      },
      {
        key: "TTS_VOICE_ID",
        desc: "REQUIRED. The specific voice ID. For GeminiGen: sign in at https://geminigen.ai/app/speech-gen → Gemini Voices tab → click a voice → copy its ID. For ElevenLabs: voice ID from their library. For Edge TTS: locale + voice name.",
        examples: "GeminiGen Gemini Voice: e.g. Kore, Puck, Charon — ElevenLabs Christopher: G17SuINrv2H9FC6nvetn — Edge: en-US-GuyNeural",
      },
      {
        key: "TTS_VOICE_NAME",
        desc: "GeminiGen REQUIRES the voice display name alongside the ID. Copy the same name shown next to the voice in the Gemini Voices dashboard. For other providers this field is ignored.",
        examples: "Kore, Puck, Charon, Aoede, Zephyr, Leda, Orus, Fenrir",
      },
      {
        key: "TTS_MODEL",
        desc: "TTS model id. `tts-flash` (default) = Gemini 2.5 Flash TTS (fast, expressive). For ElevenLabs use `eleven_multilingual_v2`. For OpenAI use `gpt-4o-mini-tts`.",
        examples: "tts-flash (geminigen default), eleven_multilingual_v2, gpt-4o-mini-tts",
      },
      {
        key: "TTS_OUTPUT_FORMAT",
        desc: "GeminiGen only — audio container. mp3 is smaller and universal, wav is uncompressed.",
        examples: "mp3 (default)  /  wav",
      },
      {
        key: "TTS_EMOTION",
        desc: "GeminiGen only — preset emotion that shapes delivery. Leave empty for neutral narration. Useful for documentary tone (`Firm`, `Informative`) or upbeat clips (`Excited`).",
        examples: "Casual, Excited, Firm, Informative, Whisper, Bedtime  ·  empty = neutral",
      },
      {
        key: "TTS_CUSTOM_PROMPT",
        desc: "GeminiGen only — free-form style instruction. Overrides preset emotions. Use for fine-grained vocal direction (e.g. `slow documentary narrator with thoughtful pauses`).",
        examples: "calm documentary narrator  ·  energetic news anchor  ·  bedtime story whisper",
      },
      {
        key: "TTS_VOICE_PROVIDER",
        desc: "69labs ONLY — which voice family inside 69labs. ElevenLabs = best quality. Edge TTS = free Microsoft voices. Voice-clone = celebrity clones. Ignored when TTS_PROVIDER is geminigen/elevenlabs/openai.",
        examples: "elevenlabs  /  edgetts  /  voice-clone",
      },
      {
        key: "TTS_SPLIT_TYPE",
        desc: "69labs ONLY — how the service chunks text internally. `smart` splits at sentence boundaries (best for narration). Ignored by GeminiGen.",
        examples: "smart  /  paragraphs  /  max_length",
      },
    ],
  },
  {
    title: "Voice Fine-Tuning (ElevenLabs voices)",
    subtitle: "Subtle voice character controls. Active when TTS_VOICE_PROVIDER = elevenlabs — works whether you reach ElevenLabs directly or through 69labs's gateway. Ignored for edgetts and voice-clone. Defaults are tuned for slower, documentary-style narration.",
    fields: [
      {
        key: "TTS_SPEED",
        desc: "Speech rate. 1.0 = neutral pace. Lower values slow the voice down. 0.93 default sounds slightly more cinematic and gives the listener more time to absorb each sentence.",
        examples: "Range 0.7–1.2  ·  default 0.93",
      },
      {
        key: "TTS_STABILITY",
        desc: "How consistent the voice sounds across the whole audio. Higher = more uniform, less variation. Lower = more expressive but can sometimes wobble.",
        examples: "Range 0–1  ·  default 0.6 (balanced for narration)",
      },
      {
        key: "TTS_SIMILARITY_BOOST",
        desc: "How closely the synthesized voice matches the source reference. Higher = more faithful to the original voice's character.",
        examples: "Range 0–1  ·  default 0.75",
      },
      {
        key: "TTS_STYLE",
        desc: "Expressiveness. 0 = calm, even delivery. Higher values inject more emotional inflection. Documentary voices usually sit around 0.1–0.2.",
        examples: "Range 0–1  ·  default 0.15",
      },
      {
        key: "TTS_USE_SPEAKER_BOOST",
        desc: "Strengthens the unique character of the speaker. Useful when you notice the voice drifting toward a generic sound. Leave at `1` unless the output sounds harsh.",
        examples: "1 = enabled  ·  0 = disabled  ·  empty = provider default",
      },
    ],
  },
  {
    title: "Sentence Pauses (ElevenLabs voices)",
    subtitle: "Inserts automatic breath pauses BETWEEN sentences within a single scene's TTS. Active for ElevenLabs voices — works through 69labs's gateway too. Note: pauses between SCENES are handled separately via SCENE_TAIL_SILENCE in Video Assembly below.",
    fields: [
      {
        key: "TTS_AUTO_PAUSE",
        desc: "Turns automatic pauses on. When off, ElevenLabs may rush through periods. Recommended on for any narration longer than 30 seconds.",
        examples: "1 = enabled  ·  empty = disabled",
      },
      {
        key: "TTS_PAUSE_DURATION",
        desc: "How long each pause is. Documentaries usually sit around 0.3–0.5s. Audiobooks can go up to 0.8s for a more reflective tempo.",
        examples: "Range 0.1–30 seconds  ·  default 0.4",
      },
      {
        key: "TTS_PAUSE_FREQUENCY",
        desc: "How often the pause is inserted. 1 = every sentence boundary. Higher numbers add the pause less often (e.g. 5 = every 5th boundary).",
        examples: "Range 1–100  ·  default 1",
      },
    ],
  },
  {
    title: "Images",
    subtitle: "Generates one still image per scene. The same image is then either used directly (Ken-Burns zoom) or as the first frame for an img2vid clip.",
    fields: [
      {
        key: "IMAGE_PROVIDER",
        desc: "Which service generates images. GeminiGen.AI is the default — direct access to Google's Gemini Image models with no per-account rate limit on nano-banana-2.",
        examples: "geminigen  /  69labs  /  replicate  /  openai  /  fal",
      },
      {
        key: "IMAGE_MODEL",
        desc: "Specific model. `nano-banana-2` (default) = Gemini 3 Flash Image, NO rate limit, great quality. `nano-banana-pro` = Gemini 3 Pro Image, top quality but rate-limited (5/min free tier). `imagen-4` = balanced fast model with great textures.",
        examples: "nano-banana-2, nano-banana-pro, imagen-4",
      },
      {
        key: "IMAGE_RATIO",
        desc: "Aspect ratio of generated images. 16:9 for landscape YouTube videos, 9:16 for vertical Shorts/Reels, 1:1 for thumbnails.",
        examples: "16:9, 9:16, 1:1, 4:3, 3:4",
      },
      {
        key: "IMAGE_RESOLUTION",
        desc: "Output resolution where supported. 1K is fastest and cheapest. 2K is visibly sharper but costs more credits. 4K is overkill for 1080p video output.",
        examples: "1K (default)  /  2K  /  4K",
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
    subtitle: "Turns selected images into short video clips with real motion. Optional — leave provider on `off` to keep everything as static Ken-Burns photos.",
    fields: [
      {
        key: "ANIMATION_PROVIDER",
        desc: "Service for img2vid. `off` skips animation entirely. `geminigen` (default when on) uses Google Veo directly with no rate limit. `69labs`, `replicate`, `fal` are alternative providers.",
        examples: "off  /  geminigen  /  69labs  /  replicate  /  fal",
      },
      {
        key: "ANIMATION_MODEL",
        desc: "Specific Veo model. `veo-3.1-fast` (default) — fastest, great quality. `veo-3.1` — slowest, premium quality. `veo-3.1-lite` — generates video with synchronized audio. `veo-2` — supports flexible duration and 9:16.",
        examples: "veo-3.1-fast, veo-3.1, veo-3.1-lite, veo-2",
      },
      {
        key: "ANIMATION_RESOLUTION",
        desc: "Output resolution for Veo clips. 720p is faster and cheaper, 1080p is sharper. Final video is downscaled to VIDEO_RESOLUTION anyway, so 720p is usually plenty.",
        examples: "720p (default)  /  1080p",
      },
      {
        key: "ANIMATION_RATIO_PERCENT",
        desc: "Percentage of scenes to animate. 100 = every scene is a video clip. 50 = half. 0 = none (Ken-Burns only).",
        examples: "0–100  ·  default 50",
      },
      {
        key: "ANIMATION_DISTRIBUTION",
        desc: "Which scenes get picked when ratio < 100. `first-half` puts video clips at the start (strong hook), photos at the end. `alternating` interleaves them. `random` picks scenes with motion keywords first.",
        examples: "first-half  /  alternating  /  random  /  all",
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
        desc: "Silence appended to the END of every scene's audio before assembly. This is the ONLY way to get pauses BETWEEN scenes — ElevenLabs's TTS_AUTO_PAUSE only handles pauses INSIDE one TTS call (intra-scene), and since each scene is a separate TTS call, scene boundaries get no breath without this setting. Raise to 0.6–0.8 if the narration still feels rushed at sentence endings.",
        examples: "0 = no padding (back-to-back)  ·  0.4 = natural breath (default)  ·  0.8 = reflective pacing",
      },
    ],
  },
  {
    title: "Performance (Concurrency)",
    subtitle: "How many parallel API jobs and FFmpeg renders to run at once. Higher = faster but risks rate limits. Defaults are tuned for 69labs's limits.",
    fields: [
      {
        key: "IMAGE_CONCURRENCY",
        desc: "Simultaneous image generation jobs. GeminiGen.AI's nano-banana-2 has NO rate limit, so this can be raised aggressively (15–20+) on a fast machine. Limited mostly by the speed of your local network and Node event loop.",
        examples: "default 5  ·  raise to 10–20+ for faster runs (no API-side cap)",
      },
      {
        key: "TTS_CONCURRENCY",
        desc: "Simultaneous TTS jobs through 69labs/ElevenLabs. ElevenLabs has generous limits, so higher = faster narration generation for long scripts.",
        examples: "default 3  ·  bump to 5–7 if you have an unlimited ElevenLabs subscription",
      },
      {
        key: "ANIMATION_CONCURRENCY",
        desc: "Simultaneous Veo img2vid jobs through GeminiGen.AI. No documented hard limit on Veo through GeminiGen, so this can be raised. Each Veo clip burns credits, so watch your budget.",
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
    subtitle: "You only need these if you want to bypass 69labs and call providers directly. Leave empty if you're using the default 69labs stack.",
    fields: [
      {
        key: "ELEVENLABS_API_KEY",
        desc: "Direct ElevenLabs API key. Only used when TTS_PROVIDER is set to `elevenlabs` (not `69labs`).",
        examples: "Sign up at https://elevenlabs.io → Profile → API Keys",
      },
      {
        key: "REPLICATE_API_TOKEN",
        desc: "Replicate token, for using Flux Schnell or Kling models directly without 69labs. Useful if you want pay-as-you-go pricing.",
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

  async function load(reveal = false) {
    const r = await fetch(`/api/settings${reveal ? "?reveal=1" : ""}`);
    setValues(await r.json());
    setRevealing(reveal);
  }

  useEffect(() => { load(false); }, []);

  async function save() {
    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
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
                <input
                  className="input"
                  value={values[f.key] ?? ""}
                  placeholder={f.examples ? `e.g. ${f.examples}` : ""}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  style={{
                    borderColor: f.required && !values[f.key] ? "#ff6d6d" : undefined,
                  }}
                />
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
    </div>
  );
}
