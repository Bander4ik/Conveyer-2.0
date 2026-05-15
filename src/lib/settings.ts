import db from "./db";

/**
 * Keys the user can edit through the UI or via .env.
 * UI takes precedence over .env (env is only the fallback when the DB row is empty).
 */
export const SETTING_KEYS = [
  // ── Required API keys ─────────────────────────────────────────────
  "GOOGLE_API_KEY",          // Gemini — scene splitting
  "GEMINIGEN_API_KEY",       // GeminiGen.AI — images + img2vid (Veo)
  "ALGROW_API_KEY",          // algrow.online — TTS narration (ElevenLabs / Stealth voices, 33+ to pick from)

  // ── Optional / backup providers ───────────────────────────────────
  "ELEVENLABS_API_KEY",      // direct ElevenLabs (fallback when TTS_PROVIDER=elevenlabs)
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
  "TTS_PROVIDER",            // algrow (default) | elevenlabs | openai
  "TTS_VOICE_PROVIDER",      // algrow only: elevenlabs | stealth — which catalog the voice came from
  "TTS_VOICE_ID",            // Voice id from the chosen catalog
  "TTS_VOICE_NAME",          // Voice display name (for logs + filenames)
  "TTS_MODEL",               // e.g. eleven_multilingual_v2 (algrow elevenlabs) or empty
  "TTS_STABILITY",           // algrow elevenlabs: 0–1 voice stability
  "TTS_SIMILARITY_BOOST",    // algrow elevenlabs: 0–1
  "TTS_STYLE",               // algrow elevenlabs: 0–1 expressiveness
  "TTS_SPEED",               // 0.7–1.2 ElevenLabs range

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
  ALGROW_API_KEY: "",

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

  // TTS — algrow.online by default. Browse + preview voices in /settings
  // (Browse voices button → modal with 5-second audio samples).
  TTS_PROVIDER: "algrow",
  TTS_VOICE_PROVIDER: "elevenlabs",   // algrow sub-catalog: elevenlabs (default) or stealth
  TTS_VOICE_ID: "",                   // user picks via Browse voices modal
  TTS_VOICE_NAME: "",                 // auto-filled when a voice is picked
  TTS_MODEL: "eleven_multilingual_v2",
  TTS_STABILITY: "0.6",
  TTS_SIMILARITY_BOOST: "0.75",
  TTS_STYLE: "0.15",
  TTS_SPEED: "1.0",

  // Images — OFF by default in v2. Veo runs text-to-video so the image stage
  // is unnecessary AND the rate-limited nano-banana-pro was the slowest /
  // most-failing step. To re-enable img2vid keyframes, set IMAGE_PROVIDER to
  // geminigen (or replicate / openai / fal) — pipeline auto-detects.
  IMAGE_PROVIDER: "off",
  IMAGE_MODEL: "nano-banana-pro",
  IMAGE_RATIO: "16:9",
  IMAGE_RESOLUTION: "2K",
  IMAGE_OUTPUT_FORMAT: "png",
  IMAGE_STYLE: "Photorealistic",

  // Animations — every scene gets a Veo clip in v2. Valid GeminiGen Veo
  // model ids (per the live API's INVALID_INPUT response): veo-2, veo-3,
  // veo-3-fast. The docs page mentions veo-3.1 / veo-3.1-fast but those
  // strings are rejected at the server — likely stale docs. veo-3 is the
  // full quality variant, veo-3-fast is the speed-optimized variant.
  ANIMATION_PROVIDER: "geminigen",
  ANIMATION_MODEL: "veo-3",
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
  //  - IMAGE_CONCURRENCY: unused while IMAGE_PROVIDER=off; 3 is safe for
  //    nano-banana-pro (5/min free-tier rate limit) if you re-enable images.
  //  - TTS_CONCURRENCY: algrow.online limits to 30 requests/min. With ~5-10s
  //    per request, 3 parallel jobs comfortably stays under that ceiling.
  //  - ANIMATION_CONCURRENCY: 2 because veo-3.1 (full) is slow and each clip
  //    costs credits. Bump to 4–6 if you switch to veo-3.1-fast.
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
  // Two staged migrations, each tracked by its own flag.

  // Stage 1: v1 → v2 (video-only pipeline). Idempotent.
  const flag1 = getStmt.get("_migration_v2_video_only") as { value: string } | undefined;
  if (flag1?.value !== "1") {
    const stage1: Array<[string, (current: string) => string | null]> = [
      ["TTS_PROVIDER", (v) => (v === "69labs" ? "geminigen" : null)],
      ["IMAGE_PROVIDER", (v) => (v === "69labs" ? "geminigen" : null)],
      ["ANIMATION_PROVIDER", (v) => (v === "69labs" || v === "off" ? "geminigen" : null)],
      ["ANIMATION_RATIO_PERCENT", (v) => (v === "50" ? "100" : null)],
      ["ANIMATION_DISTRIBUTION", (v) => (v === "first-half" ? "all" : null)],
      ["IMAGE_MODEL", (v) => (v === "imagen-4" || v === "" ? "nano-banana-pro" : null)],
      ["ANIMATION_MODEL", (v) => (v === "veo-3.1-fast" ? "veo-3.1" : null)],
      ["IMAGE_RESOLUTION", (v) => (v === "1K" ? "2K" : null)],
      ["ANIMATION_RESOLUTION", (v) => (v === "720p" ? "1080p" : null)],
    ];
    runMigration(stage1);
    upsertStmt.run("_migration_v2_video_only", "1");
  }

  // Stage 2: TTS_PROVIDER=geminigen → algrow (GeminiGen TTS isn't on public API).
  const flag2 = getStmt.get("_migration_v2_algrow_tts") as { value: string } | undefined;
  if (flag2?.value !== "1") {
    const stage2: Array<[string, (current: string) => string | null]> = [
      // Anyone migrated by stage 1 (or fresh v1 forker) is on TTS_PROVIDER=geminigen.
      // Force them to algrow so the pipeline doesn't try a 404 endpoint.
      ["TTS_PROVIDER", (v) => (v === "geminigen" ? "algrow" : null)],
      // Old GeminiGen voice id "Kore"/etc won't resolve in algrow — clear it so
      // the user is forced to pick from algrow's catalog via Browse voices.
      ["TTS_VOICE_ID", (v) =>
        v && /^(Kore|Puck|Charon|Aoede|Fenrir|Leda|Orus|Zephyr|en-US-)/.test(v) ? "" : null,
      ],
      ["TTS_VOICE_NAME", (v) =>
        v && /^(Kore|Puck|Charon|Aoede|Fenrir|Leda|Orus|Zephyr)$/.test(v) ? "" : null,
      ],
      ["TTS_MODEL", (v) => (v === "tts-flash" ? "eleven_multilingual_v2" : null)],
    ];
    runMigration(stage2);
    upsertStmt.run("_migration_v2_algrow_tts", "1");
  }

  // Stage 3: drop image stage by default + clamp concurrency for algrow.
  // Reasoning:
  //   - nano-banana-pro is rate-limited (5/min free) and was the single biggest
  //     source of 500s in pipeline runs. Veo can text-to-video without it.
  //   - algrow.online limits TTS to 30 req/min. 3 parallel jobs is safe.
  const flag3 = getStmt.get("_migration_v2_no_images") as { value: string } | undefined;
  if (flag3?.value !== "1") {
    const stage3: Array<[string, (current: string) => string | null]> = [
      ["IMAGE_PROVIDER", (v) => (v === "geminigen" ? "off" : null)],
      ["TTS_CONCURRENCY", (v) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) && n > 3 ? "3" : null;
      }],
      ["IMAGE_CONCURRENCY", (v) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) && n > 3 ? "3" : null;
      }],
    ];
    runMigration(stage3);
    upsertStmt.run("_migration_v2_no_images", "1");
  }

  // Stage 5: fix Veo model ids — veo-3.1 and veo-3.1-fast are not valid in
  // GeminiGen's API despite being documented. Server rejects them with
  // INVALID_INPUT and lists 'veo-2', 'veo-3', 'veo-3-fast' as accepted.
  //
  // We run this with bumped flag _v2 because the first version of this
  // migration was too narrow (only exact-match), so users with anything else
  // veo-3.1-flavored (lite, etc.) didn't get fixed.
  const flag5 = getStmt.get("_migration_v2_real_veo_ids_v2") as { value: string } | undefined;
  if (flag5?.value !== "1") {
    const stage5: Array<[string, (current: string) => string | null]> = [
      ["ANIMATION_MODEL", (v) => {
        // Catch any veo-3.1* variant the docs claimed existed.
        if (/^veo-3\.1-fast$/i.test(v)) return "veo-3-fast";
        if (/^veo-3\.1-lite$/i.test(v)) return "veo-3";
        if (/^veo-3\.1$/i.test(v)) return "veo-3";
        // Anything else with "3.1" in it → safe default
        if (/3\.1/.test(v)) return "veo-3";
        return null;
      }],
    ];
    runMigration(stage5);
    upsertStmt.run("_migration_v2_real_veo_ids_v2", "1");
  }

  // Stage 4: force-reset the scene_split prompt to the v2 long-scene template.
  // Why this is a separate stage / always wipes:
  //   The v2 algrow.online TTS provider requires ≥ 220 chars per request.
  //   Any cached scene_split prompt that targets 20-word scenes (whether the
  //   old default OR a user customization) will produce sub-220-char scenes
  //   that fail. So we unconditionally delete the prompt row here — the
  //   default-seeder then re-inserts the new template. If the user
  //   intentionally customized it for v2, they can re-edit it once after this
  //   migration runs; we won't touch it again because the flag stops re-runs.
  const flag4 = getStmt.get("_migration_v2_long_scenes") as { value: string } | undefined;
  if (flag4?.value !== "1") {
    try {
      db.prepare("DELETE FROM prompts WHERE name = ?").run("scene_split");
    } catch {}
    upsertStmt.run("_migration_v2_long_scenes", "1");
  }

  // Stage 6: bump the prompt again — first v2 long-scenes template produced
  // 35-50s audio per scene which is too long for an 8s Veo clip (the visual
  // stays frozen for the back half of each scene). New template tightens to
  // 220-380 chars / 12-18s audio per scene so Veo's clip covers most of it.
  const flag6 = getStmt.get("_migration_v2_tighter_scenes") as { value: string } | undefined;
  if (flag6?.value !== "1") {
    try {
      db.prepare("DELETE FROM prompts WHERE name = ?").run("scene_split");
    } catch {}
    upsertStmt.run("_migration_v2_tighter_scenes", "1");
  }
}

function runMigration(transforms: Array<[string, (current: string) => string | null]>) {
  for (const [key, transform] of transforms) {
    const row = getStmt.get(key) as { value: string } | undefined;
    if (!row) continue;
    const next = transform(row.value);
    if (next !== null && next !== row.value) {
      upsertStmt.run(key, next);
    }
  }
}
