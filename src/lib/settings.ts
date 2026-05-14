import db from "./db";

/**
 * Keys the user can edit through the UI or via .env.
 * UI takes precedence over .env (env is only the fallback when the DB row is empty).
 */
export const SETTING_KEYS = [
  // ── Required API keys ─────────────────────────────────────────────
  "GOOGLE_API_KEY",          // Gemini — scene splitting
  "GEMINIGEN_API_KEY",       // GeminiGen.AI — images + img2vid + TTS (no rate limit on most models)

  // ── Optional / backup providers ───────────────────────────────────
  "LABS69_API_KEY",          // 69labs — optional fallback for ElevenLabs voices
  "ELEVENLABS_API_KEY",      // direct ElevenLabs (without 69labs)
  "REPLICATE_API_TOKEN",     // Replicate (Flux / Kling)
  "ANTHROPIC_API_KEY",       // Claude (alternative to Gemini)
  "OPENAI_API_KEY",          // OpenAI TTS / image backup
  "FAL_API_KEY",             // fal.ai (alternative to Replicate)
  "FFMPEG_PATH",             // absolute path to ffmpeg.exe if not in system PATH

  // ── Storage ───────────────────────────────────────────────────────
  "RUNS_OUTPUT_DIR",         // where run folders are written. Empty = default

  // ── Scene splitting (LLM) ─────────────────────────────────────────
  "SCENE_SPLIT_PROVIDER",    // google | anthropic
  "SCENE_SPLIT_MODEL",       // e.g. gemini-flash-latest, claude-sonnet-4-6

  // ── Text-to-Speech ────────────────────────────────────────────────
  "TTS_PROVIDER",            // geminigen | 69labs | elevenlabs | openai
  "TTS_VOICE_PROVIDER",      // 69labs only: edgetts | elevenlabs | voice-clone
  "TTS_VOICE_ID",            // Voice id (GeminiGen / ElevenLabs / Edge / clone UUID)
  "TTS_VOICE_NAME",          // GeminiGen: voice display name alongside id
  "TTS_MODEL",               // e.g. tts-flash (geminigen), eleven_multilingual_v2
  "TTS_SPLIT_TYPE",          // 69labs only: smart | paragraphs | max_length
  "TTS_OUTPUT_FORMAT",       // geminigen: mp3 | wav
  "TTS_EMOTION",             // geminigen: optional emotion (Casual, Excited, ...)
  "TTS_CUSTOM_PROMPT",       // geminigen: free-form style instruction

  // ── ElevenLabs voice fine-tuning ──────────────────────────────────
  "TTS_SPEED",               // 0.7–1.2 (lower = slower)
  "TTS_STABILITY",           // 0–1
  "TTS_SIMILARITY_BOOST",    // 0–1
  "TTS_STYLE",               // 0–1
  "TTS_USE_SPEAKER_BOOST",   // "1" / "0" / ""

  // ── Auto-pause (stops TTS from "swallowing" sentence ends) ────────
  "TTS_AUTO_PAUSE",          // "1" to enable
  "TTS_PAUSE_DURATION",      // seconds (0.1–30)
  "TTS_PAUSE_FREQUENCY",     // 1–100

  // ── Images ────────────────────────────────────────────────────────
  "IMAGE_PROVIDER",          // geminigen | 69labs | replicate | openai | fal
  "IMAGE_MODEL",             // e.g. nano-banana-2, nano-banana-pro, imagen-4
  "IMAGE_RATIO",             // e.g. 16:9, 9:16, 1:1
  "IMAGE_RESOLUTION",        // 1K | 2K | 4K (for models that support it)
  "IMAGE_OUTPUT_FORMAT",     // jpeg | png (geminigen)
  "IMAGE_STYLE",             // Photorealistic / Cinematic / etc (geminigen) — empty = no style

  // ── Animations (img2vid) ──────────────────────────────────────────
  "ANIMATION_PROVIDER",      // off | geminigen | 69labs | replicate | fal
  "ANIMATION_MODEL",         // e.g. veo-3.1-fast, veo-3.1, veo-2 (geminigen)
  "ANIMATION_RESOLUTION",    // 720p | 1080p (geminigen Veo)
  "ANIMATION_RATIO_PERCENT", // 0–100, percentage of scenes to animate
  "ANIMATION_DISTRIBUTION",  // first-half | alternating | random | all
  "ANIMATION_DURATION",      // seconds (provider-dependent; Veo: 4/6/8)
  "ANIMATION_KEEP_VEO_AUDIO", // "1" to keep Veo's generated ambient audio

  // ── Video assembly (FFmpeg) ───────────────────────────────────────
  "VIDEO_RESOLUTION",        // e.g. 1920x1080
  "VIDEO_FPS",               // 24 / 30 / 60
  "SCENE_DURATION_SECONDS",  // fallback duration when TTS length is unknown
  "TRANSITION_DURATION",     // crossfade between scenes in seconds (0 = none)
  "SCENE_TAIL_SILENCE",      // silence appended to each clip's audio (seconds), creates breathing room between scenes

  // ── Performance / Concurrency ─────────────────────────────────────
  "IMAGE_CONCURRENCY",       // parallel image jobs
  "TTS_CONCURRENCY",         // parallel TTS jobs
  "ANIMATION_CONCURRENCY",   // parallel img2vid jobs
  "ASSEMBLE_CONCURRENCY",    // parallel FFmpeg clip renders
  "ASSEMBLE_XFADE_CHUNKS",   // split final xfade into N parallel chunks (1 = monolithic)
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

const getStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const upsertStmt = db.prepare(
  "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
);

export function getSetting(key: SettingKey): string {
  const row = getStmt.get(key) as { value: string } | undefined;
  if (row && row.value !== "") return row.value;
  return process.env[key] ?? "";
}

export function setSetting(key: SettingKey, value: string) {
  upsertStmt.run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k);
  return out;
}

/** Safe version — masks secret keys/tokens. */
export function getMaskedSettings(): Record<string, string> {
  const all = getAllSettings();
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.includes("KEY") || k.includes("TOKEN")) {
      masked[k] = v ? `${v.slice(0, 4)}…${v.slice(-4)}` : "";
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

export const DEFAULTS: Record<SettingKey, string> = {
  // Required API keys — empty by default, user must provide
  GOOGLE_API_KEY: "",
  GEMINIGEN_API_KEY: "",
  LABS69_API_KEY: "",

  // Optional providers
  ELEVENLABS_API_KEY: "",
  REPLICATE_API_TOKEN: "",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  FAL_API_KEY: "",
  FFMPEG_PATH: "",

  // Storage — empty = use default (DATA_DIR/runs)
  RUNS_OUTPUT_DIR: "",

  // Scene split
  SCENE_SPLIT_PROVIDER: "google",
  SCENE_SPLIT_MODEL: "gemini-flash-latest",

  // TTS — GeminiGen by default (no rate limit, same key as images/video)
  TTS_PROVIDER: "geminigen",
  TTS_VOICE_PROVIDER: "elevenlabs",  // only used when TTS_PROVIDER=69labs
  TTS_VOICE_ID: "",                  // user must set in /settings (geminigen voice id from dashboard)
  TTS_VOICE_NAME: "",                // geminigen voice display name
  TTS_MODEL: "tts-flash",            // geminigen Gemini 2.5 Flash TTS
  TTS_SPLIT_TYPE: "smart",
  TTS_OUTPUT_FORMAT: "mp3",
  TTS_EMOTION: "",
  TTS_CUSTOM_PROMPT: "",

  // Voice fine-tuning. For GeminiGen TTS, speed is 0.25–4.0 (1.0 = normal).
  // For 69labs/ElevenLabs the same field is clamped to 0.7–1.2 internally.
  TTS_SPEED: "1.0",
  TTS_STABILITY: "0.6",
  TTS_SIMILARITY_BOOST: "0.75",
  TTS_STYLE: "0.15",
  TTS_USE_SPEAKER_BOOST: "1",

  // Auto-pause on sentence boundaries
  TTS_AUTO_PAUSE: "1",
  TTS_PAUSE_DURATION: "0.4",
  TTS_PAUSE_FREQUENCY: "1",

  // Images — GeminiGen.AI Gemini 3 Pro Image (nano-banana-pro) for maximum
  // quality. nano-banana-pro is "professional asset creation, advanced
  // reasoning, high-fidelity text" per the docs. Free tier has a 5/min rate
  // limit so we lower IMAGE_CONCURRENCY accordingly.
  IMAGE_PROVIDER: "geminigen",
  IMAGE_MODEL: "nano-banana-pro",
  IMAGE_RATIO: "16:9",
  IMAGE_RESOLUTION: "2K",
  IMAGE_OUTPUT_FORMAT: "png",
  IMAGE_STYLE: "Photorealistic",

  // Animations — GeminiGen.AI Veo 3.1 (full) at 1080p for maximum cinematic
  // quality. veo-3.1 is the "Latest high-quality video generation model with
  // enhanced capabilities" per the docs. Each clip burns more credits than
  // veo-3.1-fast and takes longer — switch to veo-3.1-fast if budget/time is
  // tight.
  ANIMATION_PROVIDER: "off",
  ANIMATION_MODEL: "veo-3.1",
  ANIMATION_RESOLUTION: "1080p",
  ANIMATION_RATIO_PERCENT: "50",
  ANIMATION_DISTRIBUTION: "first-half",
  ANIMATION_DURATION: "8",
  ANIMATION_KEEP_VEO_AUDIO: "",

  // Video assembly
  VIDEO_RESOLUTION: "1920x1080",
  VIDEO_FPS: "30",
  SCENE_DURATION_SECONDS: "5",
  TRANSITION_DURATION: "0.5",
  SCENE_TAIL_SILENCE: "0.4",

  // Performance
  //  - IMAGE_CONCURRENCY: 3 keeps us under nano-banana-pro's 5/min free-tier
  //    cap. Switch to nano-banana-2 (no limit) and raise to 15+ for high
  //    throughput.
  //  - ANIMATION_CONCURRENCY: 2 because veo-3.1 (full) is the slowest model
  //    and each clip costs more credits. Bump to 4–6 with veo-3.1-fast.
  IMAGE_CONCURRENCY: "3",
  TTS_CONCURRENCY: "3",
  ANIMATION_CONCURRENCY: "2",
  ASSEMBLE_CONCURRENCY: "4",
  ASSEMBLE_XFADE_CHUNKS: "4",
};

/** Write defaults for any keys that aren't already in the DB. */
export function seedDefaults() {
  for (const [k, v] of Object.entries(DEFAULTS)) {
    const row = getStmt.get(k) as { value: string } | undefined;
    if (!row) upsertStmt.run(k, v);
  }
}
