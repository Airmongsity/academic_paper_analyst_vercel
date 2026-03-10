import { NextRequest, NextResponse } from "next/server";
import { fetchPdfBlob } from "@/lib/ncpssd-pdf";
import { extractTextFromPdf, cleanPdfText, splitIntoChunks, normalizeWhitespace } from "@/lib/pdf-utils";

export const runtime = "nodejs";
export const maxDuration = 120;

type PaperInput = {
  link: string;
  source?: "scholar" | "ncpssd";
  pdfUrl?: string;
  title?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const papers = (body.papers ?? []) as PaperInput[];
    if (papers.length === 0) {
      return NextResponse.json({ error: "未选择论文" }, { status: 400 });
    }

    const allChunks: { title: string; chunks: string[] }[] = [];
    let failed = 0;

    for (const paper of papers) {
      let pdfBuffer: Buffer | null = null;

      if (paper.source === "ncpssd" && paper.link) {
        pdfBuffer = await fetchPdfBlob(paper.link);
      } else if (paper.pdfUrl?.trim()) {
        const res = await fetch(paper.pdfUrl);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          pdfBuffer = Buffer.from(ab);
        }
      }

      if (!pdfBuffer || pdfBuffer.length === 0) {
        failed++;
        continue;
      }

      const rawText = await extractTextFromPdf(pdfBuffer);
      const cleaned = cleanPdfText(rawText);
      const rawChunks = await splitIntoChunks(cleaned);
      const chunks = rawChunks.map((c) => normalizeWhitespace(c)).filter(Boolean);

      allChunks.push({
        title: paper.title ?? "未知",
        chunks,
      });
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
