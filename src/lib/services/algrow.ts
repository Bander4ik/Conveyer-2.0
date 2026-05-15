import fs from "node:fs";
import { getSetting } from "../settings";
import { log, type LogLevel } from "../logger";

/**
 * Algrow API client (https://algrow.online).
 *
 * Algrow proxies multiple TTS backends — ElevenLabs and Stealth — under a single
 * REST API. ~33 voices total at the time of writing. Each voice exposes a
 * preview_url (~5s sample MP3) which we serve back to the UI so the user can
 * audition voices before picking.
 *
 * Auth: Bearer token (ALGROW_API_KEY in /settings).
 *
 * Pricing: TTS endpoints require a Professional or Ultimate plan on Algrow's
 * side. Image/video/scrape endpoints are out of scope here.
 *
 * Async pattern:
 *   1. POST /api/generate-simple (multipart) → { job_id, status: "pending" }
 *   2. GET /api/job-status/{job_id} every ~2 s → status: "pending"|"processing"|"completed"|"failed"
 *   3. On completed: audio_url is the permanent MP3 link → download.
 */

const BASE = "https://api.algrow.online";
// Algrow polls share a 60/min limit. With N parallel scenes polling every
// POLL_INTERVAL_MS, each scene issues ~60_000/POLL_INTERVAL_MS polls per minute.
// 5 s × 10 scenes = 120/min — still over. The rate limiter below catches what
// the interval doesn't, but a slower base interval reduces wasted blocking time.
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_MS = 5 * 60 * 1000;

// Two independent sliding windows: submits and status polls have different
// rate caps on Algrow's side, so we track them separately.
//   POST /api/generate-simple → 30 / min  (we use 28 for headroom)
//   GET  /api/job-status/{id} → 60 / min  (we use 55 for headroom)
const RATE_WINDOW_MS = 60_000;
const submitTimestamps: number[] = [];
const statusTimestamps: number[] = [];

async function rateLimitWait(window: number[], maxPerWindow: number): Promise<void> {
  while (true) {
    const now = Date.now();
    while (window.length && now - window[0] > RATE_WINDOW_MS) window.shift();
    if (window.length < maxPerWindow) {
      window.push(now);
      return;
    }
    const sleepMs = RATE_WINDOW_MS - (now - window[0]) + 50;
    await sleep(sleepMs);
  }
}

const SUBMIT_MAX = 28;
const STATUS_MAX = 55;

function apiKey(): string {
  const k = getSetting("ALGROW_API_KEY");
  if (!k) {
    throw new Error(
      "ALGROW_API_KEY is not set (Settings). Get one at https://algrow.online → Settings → API Keys."
    );
  }
  return k;
}

/**
 * Parses Algrow's 429 body for the "Try again in Ns" hint. Returns ms to wait
 * or null if the body doesn't say.
 *   Example body: `{"error":"Rate limit exceeded (30 requests/min). Try again in 1s.","success":false}`
 */
function parse429Retry(body: string): number | null {
  const m = /Try again in (\d+)s/i.exec(body);
  if (!m) return null;
  const sec = parseInt(m[1], 10);
  return Number.isFinite(sec) ? Math.max(sec * 1000, 1000) : null;
}

// ── Voice catalog ──────────────────────────────────────────────────────────

export interface AlgrowVoice {
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
  /** "elevenlabs" or "stealth" — which sub-provider hosts this voice. */
  provider?: string;
}

export interface VoiceListResult {
  voices: AlgrowVoice[];
  has_more: boolean;
}

/** GET /api/voices (ElevenLabs catalog). */
export async function listElevenLabsVoices(params: {
  search?: string;
  gender?: string;
  language?: string;
  accent?: string;
  age?: string;
  sort?: "trending" | "name" | "newest";
  page?: number;
  page_size?: number;
} = {}): Promise<VoiceListResult> {
  return fetchVoiceList("/api/voices", params, "elevenlabs");
}

/** GET /api/voices/stealth (Stealth catalog — distinct backend). */
export async function listStealthVoices(params: {
  search?: string;
  page?: number;
  page_size?: number;
} = {}): Promise<VoiceListResult> {
  return fetchVoiceList("/api/voices/stealth", params, "stealth");
}

async function fetchVoiceList(
  path: string,
  params: Record<string, unknown>,
  providerTag: string
): Promise<VoiceListResult> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const url = `${BASE}${path}${qs.toString() ? `?${qs}` : ""}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!r.ok) {
    throw new Error(`Algrow ${path} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  const json = (await r.json()) as {
    success?: boolean;
    voices?: AlgrowVoice[];
    has_more?: boolean;
  };
  const voices = (json.voices ?? []).map((v) => ({ ...v, provider: providerTag }));
  return { voices, has_more: json.has_more ?? false };
}

// ── TTS job submission ─────────────────────────────────────────────────────

export interface TtsJobOpts {
  script: string;
  voiceId: string;
  /** "elevenlabs" (default) or "stealth". Must match where voiceId came from. */
  provider?: "elevenlabs" | "stealth";
  voiceName?: string;
  customTitle?: string;
  /** ElevenLabs only. Default eleven_multilingual_v2. */
  modelId?: string;
  /** ElevenLabs voice fine-tuning. All 0–1, except speed 0.7–1.2. */
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
  /** Generate SRT subtitles alongside audio (ElevenLabs only). */
  generateSrt?: boolean;
}

export interface TtsSubmitResult {
  jobId: string;
}

/** POST /api/generate-simple. Returns the queued job's id.
 *  Internally rate-limited to stay under Algrow's 30/min sliding cap, with
 *  exponential 429 retries that honor the "Try again in Ns" hint when present.
 */
export async function createTtsJob(opts: TtsJobOpts): Promise<TtsSubmitResult> {
  // FormData has to be rebuilt per attempt — a consumed stream can't be reused.
  const buildForm = () => {
    const form = new FormData();
    form.append("script", opts.script);
    form.append("voice_id", opts.voiceId);
    if (opts.provider) form.append("provider", opts.provider);
    if (opts.voiceName) form.append("voice_name", opts.voiceName);
    if (opts.customTitle) form.append("custom_title", opts.customTitle);
    if (opts.modelId) form.append("model_id", opts.modelId);
    if (opts.stability !== undefined) form.append("stability", String(opts.stability));
    if (opts.similarityBoost !== undefined) form.append("similarity_boost", String(opts.similarityBoost));
    if (opts.style !== undefined) form.append("style", String(opts.style));
    if (opts.speed !== undefined) form.append("speed", String(opts.speed));
    if (opts.generateSrt !== undefined) form.append("generate_srt", String(opts.generateSrt));
    return form;
  };

  const MAX_ATTEMPTS = 6;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await rateLimitWait(submitTimestamps, SUBMIT_MAX);
    const r = await fetch(`${BASE}/api/generate-simple`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: buildForm(),
    });

    if (r.ok) {
      const json = (await r.json()) as { success?: boolean; job_id?: string; status?: string; message?: string };
      if (!json.job_id) {
        throw new Error(`Algrow TTS submit: no job_id (${JSON.stringify(json).slice(0, 200)})`);
      }
      return { jobId: json.job_id };
    }

    const body = (await r.text()).slice(0, 400);

    // 429 is recoverable — wait per server's hint (or exponential backoff)
    // and retry. Don't count it as a real failure unless we exhaust retries.
    if (r.status === 429 && attempt < MAX_ATTEMPTS) {
      const hinted = parse429Retry(body);
      const waitMs = hinted ?? Math.min(2000 * 2 ** (attempt - 1), 30_000);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Algrow TTS submit ${r.status}: ${body}`);
  }
  throw new Error("Algrow TTS submit: exhausted retries (rate-limited)");
}

// ── Polling + download ─────────────────────────────────────────────────────

interface JobStatus {
  job_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  status_detail?: string;
  status_detail_message?: string;
  audio_url?: string;
  transcript_url?: string;
  error?: string;
  message?: string;
}

async function fetchJobStatus(jobId: string): Promise<JobStatus> {
  // Status checks share their own sliding window. On 429, honor the server's
  // "Try again in Ns" hint up to 6 times — much better than killing the
  // whole scene because a poll attempt happened to land at minute boundary.
  const MAX_ATTEMPTS = 6;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await rateLimitWait(statusTimestamps, STATUS_MAX);
    const r = await fetch(`${BASE}/api/job-status/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    });
    if (r.ok) return (await r.json()) as JobStatus;
    const body = (await r.text()).slice(0, 200);
    if (r.status === 429 && attempt < MAX_ATTEMPTS) {
      const hinted = parse429Retry(body);
      const waitMs = hinted ?? Math.min(2000 * 2 ** (attempt - 1), 30_000);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`Algrow status ${jobId} ${r.status}: ${body}`);
  }
  throw new Error(`Algrow status ${jobId}: exhausted retries (rate-limited)`);
}

/** Polls until status === completed, returns the final audio URL. */
export async function pollJob(
  jobId: string,
  runId: string,
  stage: string,
  level: LogLevel = "debug"
): Promise<string> {
  const start = Date.now();
  while (true) {
    const item = await fetchJobStatus(jobId);
    if (level !== "debug") {
      log(runId, level, `algrow ${jobId.slice(0, 8)} → ${item.status}`, { stage });
    }
    if (item.status === "completed") {
      if (!item.audio_url) {
        throw new Error(`Algrow job ${jobId} completed but no audio_url`);
      }
      return item.audio_url;
    }
    if (item.status === "failed") {
      throw new Error(`Algrow job ${jobId} failed: ${item.error ?? item.status_detail_message ?? "unknown"}`);
    }
    if (Date.now() - start > POLL_MAX_MS) {
      throw new Error(`Algrow job ${jobId} exceeded ${POLL_MAX_MS / 1000}s polling timeout`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Downloads the generated MP3 to a local file. */
export async function downloadAudio(url: string, outPath: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Algrow download ${url} ${r.status}`);
  }
  fs.writeFileSync(outPath, Buffer.from(await r.arrayBuffer()));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
