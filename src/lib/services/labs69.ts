import fs from "node:fs";
import { getSetting } from "../settings";
import { log, type LogLevel } from "../logger";

/**
 * 69labs.vip API client.
 *
 * A single API key (vk_...) covers TTS + images + videos.
 * All endpoints use the async job pattern: create → poll → download.
 *
 * Docs:    https://69labs.vip/api-docs
 * OpenAPI: https://69labs.vip/api/docs/openapi.yaml
 */

const BASE = "https://69labs.vip/api/v1";
const POLL_INTERVAL_MS = 2500;
// nano-banana-pro 2K can legitimately take 4–5 min. 8 min is enough headroom
// without keeping zombie polls alive forever.
const POLL_MAX_MS = 8 * 60 * 1000;

type JobKind = "tts" | "images" | "videos";
type JobStatus = "PENDING" | "PROCESSING" | "FINALIZING" | "COMPLETED" | "FAILED" | "CANCELLED" | "CENSORED";

function authHeaders(): Record<string, string> {
  const key = getSetting("LABS69_API_KEY");
  if (!key) throw new Error("LABS69_API_KEY is not set (Settings)");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`69labs POST ${path} ${r.status}: ${(await r.text()).slice(0, 400)}`);
  }
  return (await r.json()) as T;
}

interface JobCreatedResponse {
  id: string;
  status?: JobStatus;
  queuePosition?: number | null;
}
interface MultiJobCreatedResponse {
  jobs: JobCreatedResponse[];
}

/** TTS: create a job. Returns jobId. Supports elevenlabs / edgetts / voice-clone. */
export async function createTtsJob(opts: {
  text: string;
  voiceId: string;
  voiceProvider?: "elevenlabs" | "edgetts" | "voice-clone";
  modelId?: string;
  splitType?: "smart" | "paragraphs" | "max_length";
  // ElevenLabs voice tuning (only applies when voiceProvider=elevenlabs)
  voiceSettings?: {
    stability?: number;       // 0–1, default 0.5
    similarityBoost?: number; // 0–1, default 0.75
    speed?: number;           // 0.7–1.2, default 1.0 (lower = slower)
    style?: number;           // 0–1, default 0
    useSpeakerBoost?: boolean;
  };
  autoPauseEnabled?: boolean;     // insert automatic pauses
  autoPauseDuration?: number;     // 0.1–30 seconds
  autoPauseFrequency?: number;    // 1–100 (how often)
}): Promise<string> {
  // Voice-clone uses a different endpoint
  if (opts.voiceProvider === "voice-clone") {
    const resp = await postJson<JobCreatedResponse>("/voice-clones/generate", {
      voiceCloneId: opts.voiceId,
      text: opts.text,
    });
    return resp.id;
  }
  const body: Record<string, unknown> = {
    text: opts.text,
    voiceId: opts.voiceId,
    splitType: opts.splitType ?? "smart",
  };
  if (opts.voiceProvider) body.voiceProvider = opts.voiceProvider;
  if (opts.modelId) body.modelId = opts.modelId;
  if (opts.voiceSettings && Object.keys(opts.voiceSettings).length > 0) {
    body.voiceSettings = opts.voiceSettings;
  }
  if (opts.autoPauseEnabled) {
    body.autoPauseEnabled = true;
    if (opts.autoPauseDuration !== undefined) body.autoPauseDuration = opts.autoPauseDuration;
    if (opts.autoPauseFrequency !== undefined) body.autoPauseFrequency = opts.autoPauseFrequency;
  }
  const resp = await postJson<JobCreatedResponse>("/tts/generate", body);
  return resp.id;
}

/** Image: create a job. Returns jobId. */
export async function createImageJob(opts: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
}): Promise<string> {
  const body: Record<string, unknown> = { prompt: opts.prompt };
  if (opts.model) body.model = opts.model;
  if (opts.aspectRatio) body.aspectRatio = opts.aspectRatio;
  if (opts.resolution) body.resolution = opts.resolution;
  if (opts.imageUrls?.length) body.imageUrls = opts.imageUrls;

  const resp = await postJson<JobCreatedResponse | MultiJobCreatedResponse>("/images/generate", body);
  if ("jobs" in resp) return resp.jobs[0].id;
  return resp.id;
}

/**
 * Video: create a job. Supports:
 *  - text-to-video (prompt only)
 *  - image-to-video via imageJobId (reuses a previous /images/generate job)
 *  - image-to-video via imageUrls (external URLs)
 */
export async function createVideoJob(opts: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  duration?: string;
  imageJobId?: string;
  imageUrls?: string[];
  mute?: boolean;
}): Promise<string> {
  const body: Record<string, unknown> = { prompt: opts.prompt };
  if (opts.model) body.model = opts.model;
  if (opts.aspectRatio) body.aspectRatio = opts.aspectRatio;
  if (opts.duration) body.duration = opts.duration;
  // Mute defaults to true — we don't want Veo's ambient sounds because the TTS
  // narration is going on top.
  body.mute = opts.mute ?? true;
  if (opts.imageJobId) body.imageJobId = opts.imageJobId;
  else if (opts.imageUrls && opts.imageUrls.length) body.imageUrls = opts.imageUrls;

  const resp = await postJson<JobCreatedResponse | MultiJobCreatedResponse>("/videos/generate", body);
  if ("jobs" in resp) return resp.jobs[0].id;
  return resp.id;
}

/** Polls a job until COMPLETED or FAILED. */
export async function pollJob(
  kind: JobKind,
  jobId: string,
  runId: string,
  stage: string,
  level: LogLevel = "debug"
): Promise<void> {
  const start = Date.now();
  while (true) {
    const r = await fetch(`${BASE}/${kind}/status/${jobId}`, { headers: authHeaders() });
    if (!r.ok) {
      throw new Error(`69labs status ${kind}/${jobId} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
    const json = (await r.json()) as { status: JobStatus; userMessage?: string | null };
    if (level !== "debug") {
      log(runId, level, `${kind} ${jobId.slice(0, 8)} → ${json.status}`, { stage });
    }
    if (json.status === "COMPLETED") return;
    if (json.status === "FAILED" || json.status === "CANCELLED" || json.status === "CENSORED") {
      throw new Error(
        `69labs ${kind} job ${jobId} ${json.status}${json.userMessage ? `: ${json.userMessage}` : ""}`
      );
    }
    if (Date.now() - start > POLL_MAX_MS) {
      throw new Error(`69labs ${kind} job ${jobId} exceeded ${POLL_MAX_MS / 1000}s polling timeout`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Best-effort job cancellation. Used after polling timeout to free up the concurrent slot. */
export async function cancelJob(kind: JobKind, jobId: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/${kind}/cancel/${jobId}`, {
      method: "POST",
      headers: { Authorization: authHeaders().Authorization },
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Downloads a completed job's output to the given path. */
export async function downloadJob(kind: JobKind, jobId: string, outPath: string): Promise<void> {
  const r = await fetch(`${BASE}/${kind}/download/${jobId}`, {
    headers: { Authorization: authHeaders().Authorization },
    redirect: "follow",
  });
  if (!r.ok) {
    throw new Error(`69labs download ${kind}/${jobId} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
