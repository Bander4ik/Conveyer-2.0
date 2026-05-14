import fs from "node:fs";
import path from "node:path";
import { getSetting } from "../settings";
import { getPrompt } from "../prompts";
import { log } from "../logger";
import type { Scene } from "./scene-split";
import {
  createImageJob as ggCreateImage,
  pollJob as ggPollJob,
  extractResultUrl as ggExtractResultUrl,
  downloadToFile as ggDownload,
} from "./geminigen";

export interface ImageResult {
  /** Path to the png file. */
  filePath: string;
  /** Provider's job id (if supported) — used to chain into img2vid without re-uploading. */
  providerJobId?: string;
  /** Which provider made the image. */
  provider: string;
}

/**
 * Generates one illustration for a scene.
 * Default provider: geminigen.ai (nano-banana-pro for max quality).
 * Fallback providers: Replicate (Flux), OpenAI Images, fal.ai.
 *
 * 69labs was removed in v2 — GeminiGen.AI covers all our needs with no
 * rate limit on its core models.
 */
export async function generateImage(
  runId: string,
  scene: Scene,
  outDir: string
): Promise<ImageResult> {
  const provider = (getSetting("IMAGE_PROVIDER") || "geminigen").toLowerCase();
  const styleSuffix = getPrompt("image_prompt");
  const finalPrompt = `${scene.visual_prompt}, ${styleSuffix}`;
  const fileName = `scene_${String(scene.index).padStart(3, "0")}.png`;
  const filePath = path.join(outDir, fileName);

  log(runId, "info", `Image scene #${scene.index} (${provider})`, {
    stage: "image",
    data: { provider, prompt: finalPrompt.slice(0, 120) },
  });

  if (provider === "geminigen") {
    const uuid = await geminigenImage(runId, finalPrompt, filePath);
    log(runId, "success", `Image saved: ${fileName}`, { stage: "image" });
    return { filePath, providerJobId: uuid, provider };
  }
  if (provider === "replicate") {
    await replicateImage(finalPrompt, filePath);
  } else if (provider === "openai") {
    await openaiImage(finalPrompt, filePath);
  } else if (provider === "fal") {
    await falImage(finalPrompt, filePath);
  } else {
    throw new Error(`Unknown image provider: ${provider}. Supported: geminigen, replicate, openai, fal.`);
  }
  log(runId, "success", `Image saved: ${fileName}`, { stage: "image" });
  return { filePath, provider };
}

/**
 * GeminiGen.AI image generation. Default provider — no per-account
 * concurrency limit (with nano-banana-2), so we can fire as many parallel
 * requests as our IMAGE_CONCURRENCY allows.
 */
async function geminigenImage(runId: string, prompt: string, outPath: string): Promise<string> {
  const model = getSetting("IMAGE_MODEL") || "nano-banana-2";
  const aspectRatio = getSetting("IMAGE_RATIO") || "16:9";
  const resolution = getSetting("IMAGE_RESOLUTION") || "1K";
  const outputFormat = getSetting("IMAGE_OUTPUT_FORMAT") || "png";
  const style = getSetting("IMAGE_STYLE") || undefined; // e.g. Photorealistic, Cinematic — empty = no style override

  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const job = await ggCreateImage({
        prompt,
        model,
        aspectRatio,
        resolution,
        outputFormat,
        style,
      });
      log(
        runId,
        "debug",
        `geminigen image job ${job.uuid.slice(0, 8)}… (model=${model}, aspect=${aspectRatio}, res=${resolution}, attempt=${attempt})`,
        { stage: "image" }
      );
      const item = await ggPollJob("image", job.uuid, runId, "image");
      const url = ggExtractResultUrl("image", item);
      await ggDownload(url, outPath);
      return job.uuid;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_ATTEMPTS) {
        const delay = 5000 * attempt;
        log(runId, "warn", `geminigen image attempt ${attempt}/${MAX_ATTEMPTS} failed: ${msg.slice(0, 200)} — retry in ${delay}ms`, {
          stage: "image",
        });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function replicateImage(prompt: string, outPath: string) {
  const token = getSetting("REPLICATE_API_TOKEN");
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set");
  const model = getSetting("IMAGE_MODEL") || "black-forest-labs/flux-schnell";
  const aspect = getSetting("IMAGE_RATIO") || "16:9";

  const create = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ input: { prompt, aspect_ratio: aspect, output_format: "png" } }),
  });

  if (!create.ok) {
    throw new Error(`Replicate ${create.status}: ${(await create.text()).slice(0, 300)}`);
  }
  const json = (await create.json()) as { output?: string | string[] };
  const urlOrUrls = json.output;
  let imageUrl: string | undefined;
  if (typeof urlOrUrls === "string") imageUrl = urlOrUrls;
  else if (Array.isArray(urlOrUrls) && urlOrUrls.length > 0) imageUrl = urlOrUrls[0];
  if (!imageUrl) throw new Error(`Replicate returned no output: ${JSON.stringify(json).slice(0, 300)}`);

  const img = await fetch(imageUrl);
  if (!img.ok) throw new Error(`Failed to download image: ${img.status}`);
  fs.writeFileSync(outPath, Buffer.from(await img.arrayBuffer()));
}

async function openaiImage(prompt: string, outPath: string) {
  const key = getSetting("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const model = getSetting("IMAGE_MODEL") || "gpt-image-1";

  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, size: "1792x1024", n: 1 }),
  });
  if (!resp.ok) throw new Error(`OpenAI image ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const json = (await resp.json()) as { data: { b64_json?: string; url?: string }[] };
  const item = json.data?.[0];
  if (item?.b64_json) {
    fs.writeFileSync(outPath, Buffer.from(item.b64_json, "base64"));
  } else if (item?.url) {
    const r = await fetch(item.url);
    fs.writeFileSync(outPath, Buffer.from(await r.arrayBuffer()));
  } else {
    throw new Error("OpenAI image: empty output");
  }
}

async function falImage(prompt: string, outPath: string) {
  const key = getSetting("FAL_API_KEY");
  if (!key) throw new Error("FAL_API_KEY is not set");
  const model = getSetting("IMAGE_MODEL") || "fal-ai/flux/schnell";
  const aspect = getSetting("IMAGE_RATIO") || "16:9";

  const resp = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, aspect_ratio: aspect, output_format: "png" }),
  });
  if (!resp.ok) throw new Error(`fal ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const json = (await resp.json()) as { images?: { url: string }[] };
  const url = json.images?.[0]?.url;
  if (!url) throw new Error("fal: empty output");
  const img = await fetch(url);
  fs.writeFileSync(outPath, Buffer.from(await img.arrayBuffer()));
}
