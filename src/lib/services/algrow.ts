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
const POLL_INTERVAL_MS = 2500;
// TTS is fast but long scripts can queue; 5 min is plenty.
const POLL_MAX_MS = 5 * 60 * 1000;

function apiKey(): string {
  const k = getSetting("ALGROW_API_KEY");
  if (!k) {
    throw new Error(
      "ALGROW_API_KEY is not set (Settings). Get one at https://algrow.online → Settings → API Keys."
    );
  }
  return k;
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

/** POST /api/generate-simple. Returns the queued job's id. */
export async function createTtsJob(opts: TtsJobOpts): Promise<TtsSubmitResult> {
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

  const r = await fetch(`${BASE}/api/generate-simple`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!r.ok) {
    throw new Error(`Algrow TTS submit ${r.status}: ${(await r.text()).slice(0, 400)}`);
  }
  const json = (await r.json()) as { success?: boolean; job_id?: string; status?: string; message?: string };
  if (!json.job_id) {
    throw new Error(`Algrow TTS submit: no job_id (${JSON.stringify(json).slice(0, 200)})`);
  }
  return { jobId: json.job_id };
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
  const r = await fetch(`${BASE}/api/job-status/${jobId}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!r.ok) {
    throw new Error(`Algrow status ${jobId} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  return (await r.json()) as JobStatus;
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
