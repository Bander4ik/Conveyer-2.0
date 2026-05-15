import path from "node:path";
import fs from "node:fs";
import db from "./db";
import { log } from "./logger";
import { getSetting } from "./settings";
import { getRunDir } from "./run-paths";
import { pLimit } from "./plimit";
import { splitScript } from "./services/scene-split";
import { synthesizeScene } from "./services/tts";
import { generateImage } from "./services/image-gen";
import { animateScene, pickScenesToAnimate } from "./services/img2vid";
import { assembleVideo, type AssembleInput } from "./services/video-assemble";
import { checkCancelled, clearCancelled, CancelledError } from "./cancellation";

const updateRun = db.prepare(
  "UPDATE runs SET status = ?, output_path = ?, updated_at = datetime('now') WHERE id = ?"
);

export async function runPipeline(runId: string, script: string) {
  const runDir = getRunDir(runId);
  const audioDir = path.join(runDir, "audio");
  const imgDir = path.join(runDir, "images");
  const animDir = path.join(runDir, "animations");
  for (const d of [runDir, audioDir, imgDir, animDir]) fs.mkdirSync(d, { recursive: true });

  try {
    clearCancelled(runId);
    updateRun.run("running", null, runId);
    log(runId, "info", `Pipeline started · folder: ${path.basename(runDir)}`, { stage: "pipeline" });

    // 1. Split script into scenes
    const scenes = await splitScript(runId, script);
    checkCancelled(runId);
    fs.writeFileSync(path.join(runDir, "scenes.json"), JSON.stringify(scenes, null, 2), "utf-8");

    // 2. Per scene: TTS + Image + (Animation as soon as image is ready) — all
    //    interleaved in a single loop. No "wait for all images then start animations"
    //    phase, which saves ~30–50% of total time.
    const imageConcurrency = Math.max(1, Number(getSetting("IMAGE_CONCURRENCY") || "5"));
    const ttsConcurrency = Math.max(1, Number(getSetting("TTS_CONCURRENCY") || "3"));
    const animConcurrency = Math.max(1, Number(getSetting("ANIMATION_CONCURRENCY") || "3"));
    const limitImg = pLimit(imageConcurrency);
    const limitTts = pLimit(ttsConcurrency);
    const limitAnim = pLimit(animConcurrency);

    const animProvider = (getSetting("ANIMATION_PROVIDER") || "off").toLowerCase();
    const animRatio = Number(getSetting("ANIMATION_RATIO_PERCENT") || "50");
    const animDistRaw = (getSetting("ANIMATION_DISTRIBUTION") || "first-half").toLowerCase();
    const animDistribution =
      animDistRaw === "alternating" || animDistRaw === "random" || animDistRaw === "all"
        ? (animDistRaw as "alternating" | "random" | "all")
        : "first-half";
    const animTargets =
      animProvider !== "off"
        ? pickScenesToAnimate(scenes, animRatio, animDistribution)
        : new Set<number>();

    log(
      runId,
      "info",
      `Generating ${scenes.length} scenes. Concurrency: TTS=${ttsConcurrency}, image=${imageConcurrency}, anim=${animConcurrency}. Animation: ${animProvider !== "off" ? `${animTargets.size}/${scenes.length} scenes (${animDistribution})` : "off"}`,
      { stage: "pipeline" }
    );

    // v2 pipeline shape:
    //   - When IMAGE_PROVIDER is "off" (default in v2), we SKIP image generation
    //     entirely. Veo runs in text-to-video mode using just the scene's
    //     visual_prompt. The image keyframe path was useful for img2vid control
    //     but cost an extra API call and a rate-limited provider per scene —
    //     not worth it for documentary content where Veo's prompt
    //     interpretation is plenty.
    //   - When IMAGE_PROVIDER is set (geminigen/replicate/openai/fal), we keep
    //     the old img2vid flow: image first, then animate using it as keyframe.
    //     Ken-Burns photo fallback path also still works for that mode.
    const imageProviderSetting = (getSetting("IMAGE_PROVIDER") || "off").toLowerCase();
    const skipImages = imageProviderSetting === "off";

    type SceneResult = (AssembleInput & {
      _imgProviderJobId?: string;
      _imgProvider?: string;
    }) | null;

    const settled: SceneResult[] = await Promise.all(
      scenes.map(async (scene): Promise<SceneResult> => {
        try {
          checkCancelled(runId);

          // TTS always runs. Image only runs if not skipped.
          const audioPromise = limitTts(() => synthesizeScene(runId, scene, audioDir));
          const imagePromise = skipImages
            ? Promise.resolve(null)
            : limitImg(() => generateImage(runId, scene, imgDir));
          const [audio, image] = await Promise.all([audioPromise, imagePromise]);

          // Animate this scene. Text-to-video if no image, img2vid if there is one.
          // We also pass the audio duration so the animator can generate ENOUGH
          // Veo clips to cover the narration (Veo caps each clip at ~8 s, but
          // algrow scenes are 20-50 s of TTS — one clip leaves a freeze frame).
          let videoPath: string | null = null;
          if (animTargets.has(scene.index)) {
            try {
              videoPath = await limitAnim(() =>
                animateScene(
                  runId,
                  scene,
                  image?.filePath ?? null,
                  animDir,
                  {
                    providerJobId: image?.providerJobId,
                    imageProvider: image?.provider,
                    audioDurationSec: audio.durationSec,
                  }
                )
              );
            } catch (e) {
              if (skipImages) {
                // No fallback path — re-throw to fail the scene.
                throw e;
              }
              log(
                runId,
                "warn",
                `img2vid #${scene.index} failed, falling back to Ken-Burns: ${(e as Error).message}`,
                { stage: "animate" }
              );
            }
          }

          // In skip-images mode the scene MUST have a video (no image fallback).
          if (skipImages && !videoPath) {
            throw new Error(`Scene #${scene.index} produced no video (Veo failed and no image fallback exists in skip-images mode)`);
          }

          return {
            scene,
            imagePath: image?.filePath ?? videoPath!,  // assembly uses videoPath if image is null
            videoPath,
            audio,
            _imgProviderJobId: image?.providerJobId,
            _imgProvider: image?.provider,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log(runId, "error", `Scene #${scene.index} failed: ${msg.slice(0, 200)}`, { stage: "pipeline" });
          return null;
        }
      })
    );

    const sceneAssets = settled.filter((x): x is NonNullable<SceneResult> => x !== null);
    const failedCount = scenes.length - sceneAssets.length;

    if (failedCount > 0) {
      const failedPct = (failedCount / scenes.length) * 100;
      log(
        runId,
        failedPct > 25 ? "error" : "warn",
        `${failedCount}/${scenes.length} scenes failed (${failedPct.toFixed(0)}%)`,
        { stage: "pipeline" }
      );
      if (failedPct > 25) {
        throw new Error(`Too many scenes failed: ${failedCount}/${scenes.length}`);
      }
    }
    if (sceneAssets.length === 0) throw new Error("No scenes succeeded");

    checkCancelled(runId);

    // 3. Assemble final video
    const finalPath = await assembleVideo(runId, sceneAssets, runDir);

    updateRun.run("done", finalPath, runId);
    log(runId, "success", "Pipeline complete", { stage: "pipeline", data: { finalPath } });
  } catch (e) {
    if (e instanceof CancelledError) {
      log(runId, "warn", "Pipeline cancelled by user", { stage: "pipeline" });
      // status 'cancelled' was already set by the API endpoint, don't overwrite
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      log(runId, "error", `Pipeline crashed: ${msg}`, { stage: "pipeline" });
      updateRun.run("error", null, runId);
    }
  }
}
