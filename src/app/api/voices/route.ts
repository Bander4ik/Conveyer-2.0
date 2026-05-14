import { NextResponse } from "next/server";
import { ensureInit } from "@/lib/init";
import { listElevenLabsVoices, listStealthVoices } from "@/lib/services/algrow";

/**
 * GET /api/voices?catalog=elevenlabs|stealth&search=...&gender=...&page=1
 *
 * Server-side proxy to algrow.online's voice catalog endpoints. We forward
 * the API key from /settings so the browser never sees it, and we add the
 * `provider` tag to each voice so the picker UI knows which sub-catalog the
 * voice belongs to (needed when submitting the TTS job).
 */
export async function GET(req: Request) {
  ensureInit();
  const url = new URL(req.url);
  const catalog = (url.searchParams.get("catalog") || "elevenlabs").toLowerCase();
  const search = url.searchParams.get("search") || undefined;
  const gender = url.searchParams.get("gender") || undefined;
  const language = url.searchParams.get("language") || undefined;
  const accent = url.searchParams.get("accent") || undefined;
  const age = url.searchParams.get("age") || undefined;
  const sortRaw = url.searchParams.get("sort");
  const sort =
    sortRaw === "trending" || sortRaw === "name" || sortRaw === "newest" ? sortRaw : undefined;
  const page = parseIntOr(url.searchParams.get("page"), 1);
  const page_size = parseIntOr(url.searchParams.get("page_size"), 30);

  try {
    const result =
      catalog === "stealth"
        ? await listStealthVoices({ search, page, page_size })
        : await listElevenLabsVoices({ search, gender, language, accent, age, sort, page, page_size });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

function parseIntOr(s: string | null, fallback: number): number {
  const n = s ? parseInt(s, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
