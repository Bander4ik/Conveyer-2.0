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
  "ELEVENLABS_API_KEY",      // direct ElevenLabs (only if you want ElevenLabs instead of Gemini TTS)
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
  "TTS_PROVIDER",            // geminigen | elevenlabs | openai
  "TTS_VOICE_ID",            // Voice id (GeminiGen voice id, ElevenLabs id, OpenAI voice name)
  "TTS_VOICE_NAME",          // GeminiGen: voice display name alongside id
  "TTS_MODEL",               // e.g. tts-flash (geminigen), eleven_multilingual_v2
  "TTS_OUTPUT_FORMAT",       // geminigen: mp3 | wav
  "TTS_EMOTION",             // geminigen: optional emotion (Casual, Excited, ...)
  "TTS_CUSTOM_PROMPT",       // geminigen: free-form style instruction

  // ── TTS speed (works on geminigen, elevenlabs, openai) ───────────
  "TTS_SPEED",               // GeminiGen: 0.25–4.0 (1.0 = normal). ElevenLabs: 0.7–1.2.

  // ── Images ────────────────────────────────────────────────────────
  "IMAGE_PROVIDER",          // geminigen | replicate | openai | fal
  "IMAGE_MODEL",             // e.g. nano-banana-pro, nano-banana-2, imagen-4
  "IMAGE_RATIO",             // e.g. 16:9, 9:16, 1:1
  "IMAGE_RESOLUTION",        // 1K | 2K | 4K (for models that support it)
  "IMAGE_OUTPUT_FORMAT",     // jpeg | png (geminigen)
  "IMAGE_STYLE",             // Photorealistic / Cinematic / etc (geminigen) — empty = no style

  // ── Animations (img2vid) ──────────────────────────────────────────
  "ANIMATION_PROVIDER",      // off | geminigen | replicate | fal
  "ANIMATION_MODEL",         // e.g. veo-3.1, veo-3.1-fast, veo-3.1-lite, veo-2
  "ANIMATION_RESOLUTION",    // 720p | 1080p (geminigen Veo)
  "ANIMATION_RATIO_PERCENT", // 0–100, percentage of scenes to animate
  "ANIMATION_DISTRIBUTION",  // first-half | alternating | random | all
  "ANIMATION_DURATION",      // seconds (Veo: 4/6/8)
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
  TTS_VOICE_ID: "",                  // user must set in /settings (geminigen voice id from dashboard)
  TTS_VOICE_NAME: "",                // geminigen voice display name
  TTS_MODEL: "tts-flash",            // geminigen Gemini 2.5 Flash TTS
  TTS_OUTPUT_FORMAT: "mp3",
  TTS_EMOTION: "",
  TTS_CUSTOM_PROMPT: "",
  TTS_SPEED: "1.0",

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

  // Animations — every scene gets a Veo video clip by default in v2. The
  // image still gets generated as the keyframe for img2vid. veo-3.1 (full,
  // max quality) at 1080p. Switch to veo-3.1-fast if you need throughput.
  ANIMATION_PROVIDER: "geminigen",
  ANIMATION_MODEL: "veo-3.1",
  ANIMATION_RESOLUTION: "1080p",
  ANIMATION_RATIO_PERCENT: "100",       // EVERY scene becomes a Veo clip
  ANIMATION_DISTRIBUTION: "all",
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
  migrateLegacyValues();
}

/**
 * One-time migration v1 → v2: rewrites any setting that still points at the
 * removed `69labs` provider so existing DBs (forked from v1) don't crash the
 * pipeline. Tracked via the `_migration_v2_video_only` flag so we only do it
 * once — afterwards the user is free to set whatever they want in /settings.
 *
 * Also flips legacy 50%-photo defaults to the new 100%-video config so a v1
 * user who never touched ANIMATION_* in /settings automatically gets the
 * "every scene is a Veo clip" pipeline.
 */
function migrateLegacyValues() {
  const flagRow = getStmt.get("_migration_v2_video_only") as { value: string } | undefined;
  if (flagRow?.value === "1") return;

  const forceTo: Array<[string, (current: string) => string | null]> = [
    // 69labs → geminigen for every provider field
    ["TTS_PROVIDER", (v) => (v === "69labs" ? "geminigen" : null)],
    ["IMAGE_PROVIDER", (v) => (v === "69labs" ? "geminigen" : null)],
    ["ANIMATION_PROVIDER", (v) => (v === "69labs" || v === "off" ? "geminigen" : null)],

    // legacy 50%-photo defaults → 100% video / "all"
    ["ANIMATION_RATIO_PERCENT", (v) => (v === "50" ? "100" : null)],
    ["ANIMATION_DISTRIBUTION", (v) => (v === "first-half" ? "all" : null)],

    // models that no longer exist as 69labs aliases
    ["IMAGE_MODEL", (v) => (v === "imagen-4" || v === "" ? "nano-banana-pro" : null)],
    ["ANIMATION_MODEL", (v) => (v === "veo-3.1-fast" ? "veo-3.1" : null)],
    ["IMAGE_RESOLUTION", (v) => (v === "1K" ? "2K" : null)],
    ["ANIMATION_RESOLUTION", (v) => (v === "720p" ? "1080p" : null)],
  ];

  for (const [key, transform] of forceTo) {
    const row = getStmt.get(key) as { value: string } | undefined;
    if (!row) continue;
    const next = transform(row.value);
    if (next !== null && next !== row.value) {
      upsertStmt.run(key, next);
    }
  }

  upsertStmt.run("_migration_v2_video_only", "1");
}
