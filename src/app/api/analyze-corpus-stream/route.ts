import { NextRequest } from "next/server";
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

function send(controller: ReadableStreamDefaultController<Uint8Array>, obj: object) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n"));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const papers = (body.papers ?? []) as PaperInput[];
  const uploadedPdfs = (body.uploadedPdfs ?? []) as { name: string; base64: string }[];

  if (papers.length === 0 && uploadedPdfs.length === 0) {
    return new Response(JSON.stringify({ error: "未选择论文或上传 PDF" }), { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const allChunks: { title: string; chunks: string[] }[] = [];
        let failed = 0;
        const total = papers.length + uploadedPdfs.length;
        let idx = 0;

        for (const paper of papers) {
          idx++;
          send(controller, { type: "progress", step: "download", index: idx, total, msg: `正在下载第 ${idx} 篇 PDF：${(paper.title ?? "").slice(0, 20)}…` });

          let pdfBuffer: Buffer | null = null;
          if (paper.source === "ncpssd" && paper.link) {
            pdfBuffer = await fetchPdfBlob(paper.link);
          } else if (paper.pdfUrl?.trim()) {
            const res = await fetch(paper.pdfUrl);
            if (res.ok) pdfBuffer = Buffer.from(await res.arrayBuffer());
          }

          if (!pdfBuffer?.length) {
            failed++;
            continue;
          }

          send(controller, { type: "progress", step: "parse", index: idx, msg: "正在解析 PDF" });
          const rawText = await extractTextFromPdf(pdfBuffer);

          send(controller, { type: "progress", step: "split", index: idx, msg: "正在切分语料" });
          const cleaned = cleanPdfText(rawText);
          const rawChunks = await splitIntoChunks(cleaned);
          const chunks = rawChunks.map((c) => normalizeWhitespace(c)).filter(Boolean);

          allChunks.push({ title: paper.title ?? "未知", chunks });
        }

        for (const up of uploadedPdfs) {
          idx++;
          send(controller, { type: "progress", step: "parse", index: idx, total, msg: `正在解析上传：${up.name.slice(0, 25)}…` });

          let pdfBuffer: Buffer | null = null;
          try {
            pdfBuffer = Buffer.from(up.base64, "base64");
          } catch {
            failed++;
            continue;
          }

          if (!pdfBuffer?.length) {
            failed++;
            continue;
          }

          send(controller, { type: "progress", step: "split", index: idx, msg: "正在切分语料" });
          const rawText = await extractTextFromPdf(pdfBuffer);
          const cleaned = cleanPdfText(rawText);
          const rawChunks = await splitIntoChunks(cleaned);
          const chunks = rawChunks.map((c) => normalizeWhitespace(c)).filter(Boolean);

          allChunks.push({ title: up.name.replace(/\.pdf$/i, ""), chunks });
        }

        send(controller, {
          type: "result",
          papers: allChunks,
          totalChunks: allChunks.reduce((s, p) => s + p.chunks.length, 0),
          failed,
        });
      } catch (e) {
        send(controller, { type: "error", error: e instanceof Error ? e.message : "分析失败" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
