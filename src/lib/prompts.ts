import db from "./db";

export const PROMPT_NAMES = ["scene_split", "image_prompt", "animation_motion"] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

export const DEFAULT_PROMPTS: Record<PromptName, string> = {
  scene_split: `You are the editor of a faceless YouTube channel.
Split the provided script into scenes for an automated video pipeline.

CRITICAL RULES:
1. Cover the ENTIRE script verbatim, with NO omissions, no summarizing, no paraphrasing.
2. The concatenation of every scene's "text" field (joined by spaces) MUST equal the original script word-for-word.
3. Do NOT summarize. Do NOT add commentary. Do NOT reorder words.
4. **NEVER split a sentence in the middle.** A sentence ends ONLY at a period (.), question mark (?), or exclamation mark (!). Commas, semicolons, dashes, and colons are NOT sentence boundaries — they MUST stay inside one scene.
5. **MINIMUM SCENE LENGTH: each "text" field MUST be at least 220 characters long.** The TTS provider rejects anything shorter. If the next sentence would push you over 220, merge it. If you reach a sentence-end before 220 characters, KEEP MERGING the next sentences until you cross 220.
6. **TARGET SCENE LENGTH: 220–320 characters (~35–55 words).** Each scene should narrate for roughly 12–18 seconds at normal pace.
7. **HARD MAXIMUM: 380 characters per scene (~65 words).** Going much beyond this means the visual stays static while audio keeps playing — bad for documentary feel. Once you cross 280, look for the NEXT sentence end and stop there.
8. Each scene contains 2 to 4 COMPLETE sentences. Start a new scene at the FIRST sentence boundary AFTER you cross 220 characters.
9. **EXCEPTION for short closing lines.** If the FINAL piece of script is a single short sentence (< 220 chars) that has no remaining text after it to merge with, append it onto the previous scene instead of making it its own scene.
10. Section headings (e.g. "Part one. The configuration.") should be merged INTO the next scene's text, not stand alone — they're too short to be standalone scenes.

For EACH scene, return a JSON object with:
- "text": the exact verbatim slice of the script (no edits, no punctuation changes). MUST be ≥ 220 and SHOULD be ≤ 380 characters.
- "visual_prompt": a 40–80-word English prompt for the video generator that LITERALLY illustrates the content of this scene's text, viewed through a cosmic / astronomical lens.
  IMPORTANT:
  • The channel is space-focused — astronomy, astrophysics, planetary science. Every scene must be in the cosmic genre: stars, planets, nebulae, supernovae, black holes, auroras, the sun, planetary surfaces, comet showers, galactic shots, NASA-style astrophotography.
  • NO PEOPLE in frame. No astronauts, no scientists, no faces, no hands, no silhouettes. If the script mentions humans, replace them with an abstract space metaphor (e.g. "humanity looking at the stars" → "Earth viewed from lunar orbit, blue marble against deep space").
  • No architecture, machines, ships, cities, labs, equipment — only pure cosmic visuals.
  • Photorealistic style (style is appended later — just write the SUBSTANCE of the shot).
  • Describe MOTION — Veo generates 8-second clips so include subtle camera motion (slow zoom, drift, parallax). Example: "slow pan across surface of Mars at dawn, rust-colored dunes stretching to horizon, dust devils on the horizon".
- "duration_hint_sec": approximate length in seconds (number, 12–18).

Return a STRICTLY valid JSON array — no markdown, no explanations.

For a ~1500-word script expect ~30–45 scenes. For a ~700-word script expect ~14–22 scenes. If any "text" field is shorter than 220 chars OR longer than 400 chars, the result is wrong — RECHECK before returning.`,

  image_prompt: `documentary photography, photoreal, real-world astronomy footage style, slightly hyper-real but grounded, NASA / ESA mission imagery, telescope-grade detail, natural color grading, dramatic cinematic lighting, 16:9 aspect, sharp focus, no text overlays, no watermarks, no logos, no humans, no people, no human figures, no faces, no astronauts in frame, no sci-fi stylization, no fantasy elements, no painterly artwork`,

  animation_motion: `subtle cinematic camera motion, gentle parallax, slow drift, photographic realism, natural ambient movement, no cartoon stylization, no jarring cuts, looks like a moving photograph`,
};

const getStmt = db.prepare("SELECT content FROM prompts WHERE name = ?");
const upsertStmt = db.prepare(
  "INSERT INTO prompts (name, content, updated_at) VALUES (?, ?, datetime('now')) " +
    "ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = datetime('now')"
);

export function getPrompt(name: PromptName): string {
  const row = getStmt.get(name) as { content: string } | undefined;
  if (row?.content) return row.content;
  return DEFAULT_PROMPTS[name];
}

export function setPrompt(name: PromptName, content: string) {
  upsertStmt.run(name, content);
}

export function getAllPrompts(): Record<PromptName, string> {
  const out = {} as Record<PromptName, string>;
  for (const n of PROMPT_NAMES) out[n] = getPrompt(n);
  return out;
}

export function seedPromptDefaults() {
  for (const [n, c] of Object.entries(DEFAULT_PROMPTS)) {
    const row = getStmt.get(n) as { content: string } | undefined;
    if (!row) upsertStmt.run(n, c);
  }
}
