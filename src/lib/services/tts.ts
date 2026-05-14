import fs from "node:fs";
import path from "node:path";
import { getSetting } from "../settings";
import { log } from "../logger";
import type { Scene } from "./scene-split";
import {
  createTtsJob as algrowCreateTts,
  pollJob as algrowPollJob,
  downloadAudio as algrowDownload,
} from "./algrow";

export interface TtsResult {
  /** Path to the mp3 file. */
  filePath: string;
  /** Approximate duration in seconds (from file size, refined later via ffprobe). */
  durationSec: number;
}

/**
 * Synthesizes one scene. Default provider: algrow (https://algrow.online),
 * which proxies ElevenLabs + Stealth voices with browseable previews.
 * Fallbacks: ElevenLabs direct, OpenAI TTS.
 *
 * GeminiGen.AI TTS isn't on their public API yet — only their web app's
 * internal endpoint (Supabase-auth gated). Removed from v2 pipeline.
 *
 * Each file is sceneN.mp3 in the scene directory.
 */
export async function synthesizeScene(
  runId: string,
  scene: Scene,
  outDir: string
): Promise<TtsResult> {
  const provider = (getSetting("TTS_PROVIDER") || "algrow").toLowerCase();
  const fileName = `scene_${String(scene.index).padStart(3, "0")}.mp3`;
  const filePath = path.join(outDir, fileName);

  log(runId, "info", `TTS scene #${scene.index} (${provider})`, {
    stage: "tts",
    data: { provider, text: scene.text.slice(0, 80) },
  });

  if (provider === "algrow") {
    await algrowTts(runId, scene.text, filePath);
  } else if (provider === "elevenlabs") {
    await elevenLabs(scene.text, filePath);
  } else if (provider === "openai") {
    await openaiTts(scene.text, filePath);
  } else {
    throw new Error(`Unknown TTS provider: ${provider}. Supported: algrow, elevenlabs, openai.`);
  }

  const stats = fs.statSync(filePath);
  // Rough estimate: 16 KB/s for 128kbps mp3 — good enough for assembly.
  // Real duration is read via ffprobe in video-assemble.ts.
  const durationSec = Math.max(1, stats.size / 16000);

  log(runId, "success", `TTS done: ${fileName} (~${durationSec.toFixed(1)}s)`, {
    stage: "tts",
  });
  return { filePath, durationSec };
}

async function algrowTts(runId: string, text: string, outPath: string) {
  const voiceId = getSetting("TTS_VOICE_ID");
  if (!voiceId) {
    throw new Error(
      "Algrow TTS requires TTS_VOICE_ID — open /settings, click 'Browse voices', preview voices and pick one."
    );
  }
  const voiceName = getSetting("TTS_VOICE_NAME") || voiceId;
  // TTS_VOICE_PROVIDER tags which Algrow sub-catalog the voice came from.
  const voiceProviderRaw = (getSetting("TTS_VOICE_PROVIDER") || "elevenlabs").toLowerCase();
  const provider: "elevenlabs" | "stealth" =
    voiceProviderRaw === "stealth" ? "stealth" : "elevenlabs";

  // Optional ElevenLabs-only tuning.
  const speed = parseFloatOr(getSetting("TTS_SPEED"), 1.0);
  const stability = parseFloatOr(getSetting("TTS_STABILITY"), NaN);
  const similarity = parseFloatOr(getSetting("TTS_SIMILARITY_BOOST"), NaN);
  const style = parseFloatOr(getSetting("TTS_STYLE"), NaN);
  const modelId = getSetting("TTS_MODEL") || undefined;

  const job = await algrowCreateTts({
    script: text,
    voiceId,
    voiceName,
    provider,
    modelId: provider === "elevenlabs" ? modelId : undefined,
    speed: provider === "elevenlabs" ? clamp(speed, 0.7, 1.2) : undefined,
    stability: !Number.isNaN(stability) ? clamp(stability, 0, 1) : undefined,
    similarityBoost: !Number.isNaN(similarity) ? clamp(similarity, 0, 1) : undefined,
    style: !Number.isNaN(style) ? clamp(style, 0, 1) : undefined,
  });
  log(
    runId,
    "debug",
    `algrow TTS job ${job.jobId.slice(0, 8)}… (${provider}/${voiceName}, speed=${speed})`,
    { stage: "tts" }
  );

  const audioUrl = await algrowPollJob(job.jobId, runId, "tts");
  await algrowDownload(audioUrl, outPath);
}

function parseFloatOr(s: string, fallback: number): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

async function elevenLabs(text: string, outPath: string) {
  const apiKey = getSetting("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  const voiceId = getSetting("TTS_VOICE_ID") || "21m00Tcm4TlvDq8ikWAM";
  const model = getSetting("TTS_MODEL") || "eleven_multilingual_v2";

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, model_id: model }),
    }
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`ElevenLabs ${resp.status}: ${body.slice(0, 300)}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

async function openaiTts(text: string, outPath: string) {
  const apiKey = getSetting("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const model = getSetting("TTS_MODEL") || "gpt-4o-mini-tts";
  const voice = getSetting("TTS_VOICE_ID") || "alloy";

  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, voice, input: text, format: "mp3" }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OpenAI TTS ${resp.status}: ${body.slice(0, 300)}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}
