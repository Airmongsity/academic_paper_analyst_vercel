import { NextRequest, NextResponse } from "next/server";
import { fetchPdfBlob } from "@/lib/ncpssd-pdf";
import { extractTextFromPdf, cleanPdfText, splitIntoChunks, normalizeWhitespace } from "@/lib/pdf-utils";
import { getPaperCacheKey, getCachedChunks, setCachedChunks, type PaperInput } from "@/lib/paper-cache";

export const runtime = "nodejs";
export const maxDuration = 120;

const PDF_FETCH_RETRIES = 3;

async function fetchPdfWithRetry(paper: PaperInput): Promise<Buffer | null> {
  if (paper.source === "ncpssd" && paper.link) {
    return fetchPdfBlob(paper.link, PDF_FETCH_RETRIES - 1);
  }
  if (!paper.pdfUrl?.trim()) return null;
  for (let attempt = 0; attempt < PDF_FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(paper.pdfUrl);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      if (attempt === PDF_FETCH_RETRIES - 1) return null;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const papers = (body.papers ?? []) as PaperInput[];
    if (papers.length === 0) {
      return NextResponse.json({ error: "未选择论文" }, { status: 400 });
    }

    const maxChunkSize = typeof body?.maxChunkSize === "number" ? body.maxChunkSize : undefined;
    const minChunkSize = typeof body?.minChunkSize === "number" ? body.minChunkSize : undefined;

    const allChunks: { title: string; chunks: string[] }[] = [];
    let failed = 0;

    for (const paper of papers) {
      const cacheKey = getPaperCacheKey(paper);
      const cached = await getCachedChunks(cacheKey);
      if (cached) {
        allChunks.push(cached);
        continue;
      }

      let pdfBuffer: Buffer | null = null;
      try {
        pdfBuffer = await fetchPdfWithRetry(paper);
      } catch {
        failed++;
        continue;
      }

      if (!pdfBuffer || pdfBuffer.length === 0) {
        failed++;
        continue;
      }

      const rawText = await extractTextFromPdf(pdfBuffer);
      const cleaned = cleanPdfText(rawText);
      const rawChunks = await splitIntoChunks(cleaned, { maxChunkSize, minChunkSize });
      const chunks = rawChunks.map((c) => normalizeWhitespace(c)).filter(Boolean);

      const title = paper.title ?? "未知";
      allChunks.push({ title, chunks });
      await setCachedChunks(cacheKey, title, chunks);
    }

    return NextResponse.json({
      ok: true,
      papers: allChunks,
      totalChunks: allChunks.reduce((s, p) => s + p.chunks.length, 0),
      failed,
    });
  } catch (e) {
    console.error("[analyze-corpus]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "分析失败" },
      { status: 500 }
    );
  }
}
