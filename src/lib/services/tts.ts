import fs from "node:fs";
import path from "node:path";
import { getSetting } from "../settings";
import { log } from "../logger";
import type { Scene } from "./scene-split";
import {
  createTtsJob as labs69CreateTts,
  pollJob as labs69PollJob,
  downloadJob as labs69DownloadJob,
} from "./labs69";
import {
  createSpeechJob as geminigenCreateSpeech,
  pollJob as geminigenPollJob,
  extractResultUrl as geminigenExtractResultUrl,
  downloadToFile as geminigenDownload,
} from "./geminigen";

export interface TtsResult {
  /** Path to the mp3 file. */
  filePath: string;
  /** Approximate duration in seconds (from file size, refined later via ffprobe). */
  durationSec: number;
}

/**
 * Synthesizes one scene. Supports 69labs (default), ElevenLabs (direct), OpenAI TTS.
 * Each file is sceneN.mp3 in the scene directory.
 */
export async function synthesizeScene(
  runId: string,
  scene: Scene,
  outDir: string
): Promise<TtsResult> {
  const provider = (getSetting("TTS_PROVIDER") || "geminigen").toLowerCase();
  const fileName = `scene_${String(scene.index).padStart(3, "0")}.mp3`;
  const filePath = path.join(outDir, fileName);

  log(runId, "info", `TTS scene #${scene.index} (${provider})`, {
    stage: "tts",
    data: { provider, text: scene.text.slice(0, 80) },
  });

  if (provider === "geminigen") {
    await geminigenTts(runId, scene.text, filePath);
  } else if (provider === "69labs") {
    await labs69Tts(runId, scene.text, filePath);
  } else if (provider === "elevenlabs") {
    await elevenLabs(scene.text, filePath);
  } else if (provider === "openai") {
    await openaiTts(scene.text, filePath);
  } else {
    throw new Error(`Unknown TTS provider: ${provider}`);
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

async function geminigenTts(runId: string, text: string, outPath: string) {
  const voiceId = getSetting("TTS_VOICE_ID");
  const voiceName = getSetting("TTS_VOICE_NAME") || voiceId;
  if (!voiceId || !voiceName) {
    throw new Error(
      "GeminiGen TTS requires TTS_VOICE_ID and TTS_VOICE_NAME (set them in /settings — pick a voice at https://geminigen.ai/app/speech-gen and copy its id + name)"
    );
  }

  const model = getSetting("TTS_MODEL") || "tts-flash";
  const outputFormatRaw = (getSetting("TTS_OUTPUT_FORMAT") || "mp3").toLowerCase();
  const outputFormat = outputFormatRaw === "wav" ? "wav" : "mp3";
  const speedRaw = parseFloatOr(getSetting("TTS_SPEED"), 1.0);
  const speed = clamp(speedRaw, 0.25, 4.0);
  const emotion = getSetting("TTS_EMOTION") || undefined;
  const customPrompt = getSetting("TTS_CUSTOM_PROMPT") || undefined;

  const job = await geminigenCreateSpeech({
    input: text,
    model,
    voiceId,
    voiceName,
    speed,
    outputFormat,
    emotion,
    customPrompt,
  });
  log(
    runId,
    "debug",
    `GeminiGen TTS job ${job.uuid.slice(0, 8)}… (${voiceName}, speed=${speed}, ${outputFormat})`,
    { stage: "tts" }
  );

  const item = await geminigenPollJob("speech", job.uuid, runId, "tts");
  const url = geminigenExtractResultUrl("speech", item);
  await geminigenDownload(url, outPath);
}

async function labs69Tts(runId: string, text: string, outPath: string) {
  const voiceId = getSetting("TTS_VOICE_ID") || "en-US-GuyNeural";
  const voiceProviderRaw = (getSetting("TTS_VOICE_PROVIDER") || "edgetts").toLowerCase();
  const voiceProvider =
    voiceProviderRaw === "elevenlabs" || voiceProviderRaw === "edgetts" || voiceProviderRaw === "voice-clone"
      ? (voiceProviderRaw as "elevenlabs" | "edgetts" | "voice-clone")
      : "edgetts";
  const modelId = getSetting("TTS_MODEL") || undefined;
  const splitTypeRaw = (getSetting("TTS_SPLIT_TYPE") || "smart").toLowerCase();
  const splitType =
    splitTypeRaw === "paragraphs" || splitTypeRaw === "max_length"
      ? (splitTypeRaw as "smart" | "paragraphs" | "max_length")
      : "smart";

  // ElevenLabs-specific fine-tuning
  const voiceSettings: {
    stability?: number;
    similarityBoost?: number;
    speed?: number;
    style?: number;
    useSpeakerBoost?: boolean;
  } = {};
  if (voiceProvider === "elevenlabs") {
    const stability = parseFloatOr(getSetting("TTS_STABILITY"), NaN);
    const similarity = parseFloatOr(getSetting("TTS_SIMILARITY_BOOST"), NaN);
    const speed = parseFloatOr(getSetting("TTS_SPEED"), NaN);
    const style = parseFloatOr(getSetting("TTS_STYLE"), NaN);
    const speakerBoost = getSetting("TTS_USE_SPEAKER_BOOST");

    if (!Number.isNaN(stability)) voiceSettings.stability = clamp(stability, 0, 1);
    if (!Number.isNaN(similarity)) voiceSettings.similarityBoost = clamp(similarity, 0, 1);
    if (!Number.isNaN(speed)) voiceSettings.speed = clamp(speed, 0.7, 1.2);
    if (!Number.isNaN(style)) voiceSettings.style = clamp(style, 0, 1);
    if (speakerBoost === "1") voiceSettings.useSpeakerBoost = true;
    else if (speakerBoost === "0") voiceSettings.useSpeakerBoost = false;
  }

  // Auto-pause — stops TTS from rushing through sentence ends
  const autoPauseEnabled = getSetting("TTS_AUTO_PAUSE") === "1";
  const autoPauseDuration = parseFloatOr(getSetting("TTS_PAUSE_DURATION"), NaN);
  const autoPauseFrequency = parseFloatOr(getSetting("TTS_PAUSE_FREQUENCY"), NaN);

  const jobId = await labs69CreateTts({
    text,
    voiceId,
    voiceProvider,
    modelId,
    splitType,
    voiceSettings,
    autoPauseEnabled,
    autoPauseDuration: !Number.isNaN(autoPauseDuration) ? clamp(autoPauseDuration, 0.1, 30) : undefined,
    autoPauseFrequency: !Number.isNaN(autoPauseFrequency) ? clamp(autoPauseFrequency, 1, 100) : undefined,
  });
  log(runId, "debug", `69labs TTS job ${jobId.slice(0, 8)}… (${voiceProvider}/${voiceId}, speed=${voiceSettings.speed ?? "default"}, pause=${autoPauseEnabled ? `${autoPauseDuration}s` : "off"})`, { stage: "tts" });
  await labs69PollJob("tts", jobId, runId, "tts");
  await labs69DownloadJob("tts", jobId, outPath);
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
