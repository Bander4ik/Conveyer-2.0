import fs from "node:fs";
import { getSetting } from "../settings";
import { log, type LogLevel } from "../logger";

/**
 * GeminiGen.AI API client.
 *
 * Single API key (header `x-api-key`) covers image generation and video
 * generation (Veo, Sora, Grok, Seedance, Kling). No per-account concurrent
 * limits — only model-specific rate limits. nano-banana-2 and other non-free
 * models have NO rate limit, so we can fire as many parallel requests as we
 * want (bounded only by credits + our own concurrency settings).
 *
 * All endpoints are async: POST creates a job, returns { id, uuid, status }.
 * We then poll via `GET /uapi/v1/history/{uuid}` until status=2 (completed),
 * read the result URL from nested generated_image / generated_video, and
 * download it.
 *
 * Docs: https://docs.geminigen.ai/
 */

const BASE = "https://api.geminigen.ai/uapi/v1";
const POLL_INTERVAL_MS = 2500;
// Videos can take 2-5 min on Veo. 8 min headroom is plenty without keeping
// dead jobs alive forever.
const POLL_MAX_MS = 8 * 60 * 1000;

// Status codes from GeminiGen
const STATUS_PROCESSING = 1;
const STATUS_COMPLETED = 2;
const STATUS_FAILED = 3;

function apiKey(): string {
  const k = getSetting("GEMINIGEN_API_KEY");
  if (!k) throw new Error("GEMINIGEN_API_KEY is not set (Settings)");
  return k;
}

// ── Image generation ────────────────────────────────────────────────────────

export interface ImageGenJob {
  /** Same numeric/uuid that the API returned at create time. We poll by uuid. */
  uuid: string;
}

/**
 * POST /uapi/v1/generate_image
 * Returns the job uuid which you then poll with pollImage().
 */
export async function createImageJob(opts: {
  prompt: string;
  model?: string;            // nano-banana-2 (default), nano-banana-pro, imagen-4
  aspectRatio?: string;       // 1:1, 16:9, 9:16, 4:3, 3:4
  resolution?: string;        // 1K, 2K, 4K
  outputFormat?: string;      // jpeg (default), png
  style?: string;             // Photorealistic, Cinematic, ...
  refImageUrls?: string[];    // for image-to-image
  refHistoryUuid?: string;    // uuid of a previous geminigen image
}): Promise<ImageGenJob> {
  const form = new FormData();
  form.append("prompt", opts.prompt);
  form.append("model", opts.model ?? "nano-banana-2");
  if (opts.aspectRatio) form.append("aspect_ratio", opts.aspectRatio);
  if (opts.resolution) form.append("resolution", opts.resolution);
  if (opts.outputFormat) form.append("output_format", opts.outputFormat);
  if (opts.style) form.append("style", opts.style);
  if (opts.refHistoryUuid) form.append("ref_history", opts.refHistoryUuid);
  // The API accepts repeated `file_urls` form keys for multi-URL refs.
  if (opts.refImageUrls?.length) {
    for (const url of opts.refImageUrls) form.append("file_urls", url);
  }

  const resp = await fetch(`${BASE}/generate_image`, {
    method: "POST",
    headers: { "x-api-key": apiKey() },
    body: form,
  });
  if (!resp.ok) {
    throw new Error(`GeminiGen image ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
  }
  const json = (await resp.json()) as { uuid: string; id?: number };
  if (!json.uuid) throw new Error(`GeminiGen image: response missing uuid (${JSON.stringify(json).slice(0, 200)})`);
  return { uuid: json.uuid };
}

// ── Speech generation (Text-to-Speech via Gemini TTS) ──────────────────────

export interface SpeechGenJob {
  uuid: string;
}

/**
 * POST /uapi/v1/text-to-speech
 *
 * Returns the job uuid which you then poll with pollJob("speech", ...).
 * Voice IDs come from the user's GeminiGen account dashboard
 * (https://geminigen.ai/app/speech-gen → Gemini Voices tab).
 */
export async function createSpeechJob(opts: {
  input: string;
  model?: string;            // "tts-flash" (Gemini 2.5 Flash, default)
  voiceId: string;           // e.g. "Kore", "Puck" — copy from dashboard
  voiceName: string;         // display name — usually same as id
  speed?: number;            // 0.25 – 4.0, default 1.0
  outputFormat?: "mp3" | "wav"; // default "mp3"
  emotion?: string;          // e.g. "Casual", "Excited", "Firm"
  customPrompt?: string;     // free-form style instruction
}): Promise<SpeechGenJob> {
  const body: Record<string, unknown> = {
    input: opts.input,
    model: opts.model ?? "tts-flash",
    output_format: opts.outputFormat ?? "mp3",
    speed: opts.speed ?? 1.0,
    voices: [
      {
        voice: { id: opts.voiceId, name: opts.voiceName },
        name: opts.voiceName,
      },
    ],
  };
  if (opts.emotion) body.emotion = opts.emotion;
  if (opts.customPrompt) body.custom_prompt = opts.customPrompt;

  const resp = await fetch(`${BASE}/text-to-speech`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`GeminiGen TTS ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
  }
  const json = (await resp.json()) as { uuid?: string; id?: number; detail?: { uuid?: string } };
  const uuid = json.uuid ?? json.detail?.uuid;
  if (!uuid) throw new Error(`GeminiGen TTS: response missing uuid (${JSON.stringify(json).slice(0, 200)})`);
  return { uuid };
}

// ── Video generation (img2vid via Veo) ──────────────────────────────────────

export interface VideoGenJob {
  uuid: string;
}

/**
 * POST /uapi/v1/video-gen/veo
 *
 * Supports text-to-video (prompt only) and image-to-video (prompt + ref_images).
 * For img2vid, `modeImage` controls how reference images are used:
 *   - "frame" (default): 1-2 images → first/last keyframe
 *   - "ingredient": 1-3 images → multi-reference content guide
 */
export async function createVideoJob(opts: {
  prompt: string;
  model?: string;            // veo-3.1, veo-3.1-fast (default), veo-3.1-lite, veo-2
  resolution?: string;        // 720p (default), 1080p
  duration?: number;          // 4, 6, 8 (some models are 8-only and ignore this)
  aspectRatio?: string;       // 16:9, 9:16
  modeImage?: "frame" | "ingredient";
  refImageUrls?: string[];    // public URLs that geminigen can fetch
  refImagePaths?: string[];   // local files to upload as multipart
}): Promise<VideoGenJob> {
  const form = new FormData();
  form.append("prompt", opts.prompt);
  form.append("model", opts.model ?? "veo-3.1-fast");
  if (opts.resolution) form.append("resolution", opts.resolution);
  if (opts.duration !== undefined) form.append("duration", String(opts.duration));
  if (opts.aspectRatio) form.append("aspect_ratio", opts.aspectRatio);
  if (opts.modeImage) form.append("mode_image", opts.modeImage);

  if (opts.refImageUrls?.length) {
    for (const url of opts.refImageUrls) form.append("ref_images", url);
  }
  if (opts.refImagePaths?.length) {
    for (const filePath of opts.refImagePaths) {
      const buf = fs.readFileSync(filePath);
      // Node's File class is available in node 20+
      form.append(
        "ref_images",
        new Blob([new Uint8Array(buf)], { type: "image/png" }),
        filePath.split(/[\\/]/).pop() ?? "ref.png"
      );
    }
  }

  const resp = await fetch(`${BASE}/video-gen/veo`, {
    method: "POST",
    headers: { "x-api-key": apiKey() },
    body: form,
  });
  if (!resp.ok) {
    throw new Error(`GeminiGen video ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
  }
  const json = (await resp.json()) as { uuid: string; id?: number };
  if (!json.uuid) throw new Error(`GeminiGen video: response missing uuid (${JSON.stringify(json).slice(0, 200)})`);
  return { uuid: json.uuid };
}

// ── Polling + result retrieval ──────────────────────────────────────────────

/**
 * GET /uapi/v1/history/{uuid}
 * Returns the full job state including nested generated_image / generated_video
 * with downloadable URLs.
 */
interface HistoryItem {
  status: number;
  status_desc?: string | null;
  status_percentage?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  generated_image?: Array<{
    image_url?: string | null;
    file_download_url?: string | null;
    image_uri?: string | null;
  }>;
  generated_video?: Array<{
    video_url?: string | null;
  }>;
  generated_audio?: Array<{
    audio_url?: string | null;
    file_download_url?: string | null;
  }>;
  generate_result?: string | null;
}

async function fetchHistory(uuid: string): Promise<HistoryItem> {
  const r = await fetch(`${BASE}/history/${uuid}`, {
    headers: { "x-api-key": apiKey() },
  });
  if (!r.ok) {
    throw new Error(`GeminiGen history ${uuid} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  return (await r.json()) as HistoryItem;
}

/** Polls a job until status=2 (completed) or status=3 (failed). */
export async function pollJob(
  kind: "image" | "video" | "speech",
  uuid: string,
  runId: string,
  stage: string,
  level: LogLevel = "debug"
): Promise<HistoryItem> {
  const start = Date.now();
  while (true) {
    const item = await fetchHistory(uuid);
    if (level !== "debug") {
      log(runId, level, `${kind} ${uuid.slice(0, 8)} → status=${item.status} (${item.status_percentage ?? "?"}%)`, { stage });
    }
    if (item.status === STATUS_COMPLETED) return item;
    if (item.status === STATUS_FAILED) {
      throw new Error(
        `GeminiGen ${kind} ${uuid} failed${item.error_message ? `: ${item.error_message}` : ""}`
      );
    }
    if (item.status !== STATUS_PROCESSING) {
      // Unknown state — keep polling but log once
    }
    if (Date.now() - start > POLL_MAX_MS) {
      throw new Error(`GeminiGen ${kind} ${uuid} exceeded ${POLL_MAX_MS / 1000}s polling timeout`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Extracts the result media URL from a completed history item. */
export function extractResultUrl(kind: "image" | "video" | "speech", item: HistoryItem): string {
  if (kind === "image") {
    const img = item.generated_image?.[0];
    const url = img?.file_download_url || img?.image_url || item.generate_result;
    if (!url) throw new Error(`GeminiGen image: no result URL in history (${JSON.stringify(item).slice(0, 300)})`);
    return url;
  } else if (kind === "speech") {
    const aud = item.generated_audio?.[0];
    const url = aud?.file_download_url || aud?.audio_url || item.generate_result;
    if (!url) throw new Error(`GeminiGen speech: no result URL in history (${JSON.stringify(item).slice(0, 300)})`);
    return url;
  } else {
    const vid = item.generated_video?.[0];
    const url = vid?.video_url || item.generate_result;
    if (!url) throw new Error(`GeminiGen video: no result URL in history (${JSON.stringify(item).slice(0, 300)})`);
    return url;
  }
}

/** Downloads the result media to a local file. */
export async function downloadToFile(url: string, outPath: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`GeminiGen download ${url} ${r.status}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
