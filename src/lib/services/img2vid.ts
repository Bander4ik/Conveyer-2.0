import fs from "node:fs";
import path from "node:path";
import { getSetting } from "../settings";
import { getPrompt } from "../prompts";
import { log } from "../logger";
import type { Scene } from "./scene-split";
import {
  createVideoJob as ggCreateVideo,
  pollJob as ggPollJob,
  extractResultUrl as ggExtractResultUrl,
  downloadToFile as ggDownload,
} from "./geminigen";

/**
 * Turns a still image into a short video clip.
 * Default provider: geminigen.ai (Veo 3.1). Fallbacks: Replicate Kling/WAN,
 * fal.ai.
 *
 * Returns a path to the .mp4. If the provider is "off", returns null —
 * the assembly step then falls back to Ken-Burns on the still image.
 * 69labs was removed in v2.
 */
export async function animateScene(
  runId: string,
  scene: Scene,
  imagePath: string | null,
  outDir: string,
  _options: { providerJobId?: string; imageProvider?: string } = {}
): Promise<string | null> {
  const provider = (getSetting("ANIMATION_PROVIDER") || "geminigen").toLowerCase();
  if (provider === "off") return null;

  const fileName = `scene_${String(scene.index).padStart(3, "0")}.mp4`;
  const filePath = path.join(outDir, fileName);
  const mode = imagePath ? "img2vid" : "text-to-video";

  log(runId, "info", `${mode} scene #${scene.index} (${provider})`, {
    stage: "animate",
    data: { provider, mode, prompt: scene.visual_prompt.slice(0, 120) },
  });

  if (provider === "geminigen") {
    await geminigenImg2Vid(runId, scene, imagePath, filePath);
  } else if (provider === "replicate") {
    if (!imagePath) throw new Error("Replicate Kling requires an image keyframe — set IMAGE_PROVIDER != off");
    await replicateImg2Vid(scene, imagePath, filePath);
  } else if (provider === "fal") {
    if (!imagePath) throw new Error("fal.ai Kling requires an image keyframe — set IMAGE_PROVIDER != off");
    await falImg2Vid(scene, imagePath, filePath);
  } else {
    throw new Error(`Unknown animation provider: ${provider}. Supported: off, geminigen, replicate, fal.`);
  }

  log(runId, "success", `Animation done: ${fileName}`, { stage: "animate" });
  return filePath;
}

/**
 * GeminiGen.AI Veo. Two modes:
 *   - imagePath provided → img2vid ("frame" mode, image is first keyframe)
 *   - imagePath null     → pure text-to-video (Veo synthesizes from prompt)
 *
 * In v2 the default pipeline runs text-to-video (no image stage), trading the
 * tight keyframe control of img2vid for one fewer API call per scene plus
 * dodging nano-banana-pro's rate limits.
 */
async function geminigenImg2Vid(
  runId: string,
  scene: Scene,
  imagePath: string | null,
  outPath: string
) {
  const model = getSetting("ANIMATION_MODEL") || "veo-3.1-fast";
  const aspectRatio = getSetting("IMAGE_RATIO") || "16:9";
  const resolution = getSetting("ANIMATION_RESOLUTION") || "720p";
  const durationRaw = Number(getSetting("ANIMATION_DURATION") || "8");
  // Veo accepts 4/6/8 seconds. Snap to nearest supported value.
  const duration = durationRaw >= 7 ? 8 : durationRaw >= 5 ? 6 : 4;

  const motionStyle = getPrompt("animation_motion");
  const prompt = `${scene.visual_prompt}. ${motionStyle}`;

  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const job = await ggCreateVideo({
        prompt,
        model,
        resolution,
        duration,
        aspectRatio,
        // Only attach the image when we actually have one.
        ...(imagePath
          ? { modeImage: "frame" as const, refImagePaths: [imagePath] }
          : {}),
      });
      log(
        runId,
        "debug",
        `geminigen video job ${job.uuid.slice(0, 8)}… (model=${model}, res=${resolution}, dur=${duration}s, attempt=${attempt})`,
        { stage: "animate" }
      );
      const item = await ggPollJob("video", job.uuid, runId, "animate");
      const url = ggExtractResultUrl("video", item);
      await ggDownload(url, outPath);
      return;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_ATTEMPTS) {
        const delay = 5000 * attempt;
        log(runId, "warn", `geminigen video attempt ${attempt}/${MAX_ATTEMPTS} failed: ${msg.slice(0, 200)} — retry in ${delay}ms`, {
          stage: "animate",
        });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function replicateImg2Vid(scene: Scene, imagePath: string, outPath: string) {
  const token = getSetting("REPLICATE_API_TOKEN");
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set");

  // Default: Kling 1.6 standard — good quality/price balance.
  // Alternatives: kwaivgi/kling-v1.6-pro, wavespeedai/wan-2.1-i2v
  const model = getSetting("ANIMATION_MODEL") || "kwaivgi/kling-v1.6-standard";

  const imgB64 = fs.readFileSync(imagePath).toString("base64");
  const dataUri = `data:image/png;base64,${imgB64}`;

  const create = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      input: {
        prompt: scene.visual_prompt,
        start_image: dataUri,
        duration: 5,
        cfg_scale: 0.5,
        aspect_ratio: getSetting("IMAGE_RATIO") || "16:9",
      },
    }),
  });

  if (!create.ok) {
    throw new Error(`Replicate img2vid ${create.status}: ${(await create.text()).slice(0, 300)}`);
  }
  const json = (await create.json()) as { output?: string | string[] };
  const url = typeof json.output === "string" ? json.output : json.output?.[0];
  if (!url) throw new Error(`Replicate returned no output: ${JSON.stringify(json).slice(0, 300)}`);

  const vid = await fetch(url);
  if (!vid.ok) throw new Error(`Failed to download video: ${vid.status}`);
  fs.writeFileSync(outPath, Buffer.from(await vid.arrayBuffer()));
}

async function falImg2Vid(scene: Scene, imagePath: string, outPath: string) {
  const key = getSetting("FAL_API_KEY");
  if (!key) throw new Error("FAL_API_KEY is not set");
  const model = getSetting("ANIMATION_MODEL") || "fal-ai/kling-video/v1.6/standard/image-to-video";

  const imgB64 = fs.readFileSync(imagePath).toString("base64");
  const dataUri = `data:image/png;base64,${imgB64}`;

  const resp = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: scene.visual_prompt,
      image_url: dataUri,
      duration: "5",
      aspect_ratio: getSetting("IMAGE_RATIO") || "16:9",
    }),
  });

  if (!resp.ok) throw new Error(`fal img2vid ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const json = (await resp.json()) as { video?: { url: string } };
  const url = json.video?.url;
  if (!url) throw new Error("fal img2vid: empty output");
  const vid = await fetch(url);
  fs.writeFileSync(outPath, Buffer.from(await vid.arrayBuffer()));
}

/**
 * Picks which scenes get img2vid (the rest go through Ken-Burns on a still image).
 *
 * Distribution modes:
 *  - "first-half" (default): first `ratio%` of scenes get video, rest get photo.
 *    Creates a strong hook at the start of the video.
 *  - "alternating": every Nth scene (video / photo / video / photo).
 *  - "random": random `ratio%`, with priority for scenes that have motion-related keywords.
 *  - "all": every scene gets video (ratio = 100%).
 */
export function pickScenesToAnimate(
  scenes: Scene[],
  ratioPercent: number,
  distribution: "first-half" | "alternating" | "random" | "all" = "first-half"
): Set<number> {
  if (ratioPercent >= 100 || distribution === "all") {
    return new Set(scenes.map((s) => s.index));
  }
  if (ratioPercent <= 0) return new Set();
  const target = Math.max(1, Math.round((scenes.length * ratioPercent) / 100));

  if (distribution === "first-half") {
    return new Set(scenes.slice(0, target).map((s) => s.index));
  }

  if (distribution === "alternating") {
    const step = scenes.length / target;
    const picks = new Set<number>();
    for (let i = 0; picks.size < target && i < scenes.length; i++) {
      picks.add(Math.floor(i * step));
    }
    return picks;
  }

  // "random" — prioritize scenes whose prompt contains motion keywords
  const motionWords = /\b(moving|drift|orbit|explos|swirl|flowing|burst|spin|rotate|shoot|fly|fall|rising|crash|run|march|lift|pour|flow|surge)\b/i;
  const scored = scenes.map((s) => ({
    index: s.index,
    score: motionWords.test(s.visual_prompt) ? 2 : 1,
  }));
  scored.sort((a, b) => b.score - a.score || Math.random() - 0.5);
  return new Set(scored.slice(0, target).map((s) => s.index));
}
