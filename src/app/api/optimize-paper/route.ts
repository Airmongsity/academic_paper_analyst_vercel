import { NextRequest } from "next/server";
import OpenAI from "openai";
import { Document, Paragraph, TextRun, Packer } from "docx";
import { supabase } from "@/lib/supabase";
import { embedTexts } from "@/lib/embedding";

export const runtime = "nodejs";
export const maxDuration = 300;

const agent = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

const OPTIMIZE_PROMPT = `你是一位专业的学术论文编辑。请根据参考语料优化以下段落，使表述更清晰、学术化，同时保持原意。若参考语料与当前段落主题相关，可适当借鉴其表达；若无直接关联，仅做润色即可。只输出优化后的段落原文，不要添加解释或标注。如果小标题被错误切分到末尾，请直接在对应位置输出即可`;

type SimilarBlock = { content: string; similarity: number; title?: string };

async function searchSimilar(embedding: number[], topK = 5): Promise<SimilarBlock[]> {
  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_threshold: 0.4,
    match_count: topK,
  });
  if (error) {
    console.error("match_documents error:", error);
    return [];
  }
  return ((data ?? []) as { content: string; similarity: number; metadata?: { title?: string } }[]).map(
    (r) => ({
      content: r.content ?? "",
      similarity: r.similarity ?? 0,
      title: r.metadata?.title,
    })
  );
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, obj: object) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n"));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const chunks = Array.isArray(body?.chunks) ? body.chunks : [];
  const texts = chunks.map((c: unknown) => (typeof c === "string" ? c : "")).filter((s: string) => s.trim());
  const optimizeMask: boolean[] = Array.isArray(body?.optimizeMask)
    ? body.optimizeMask
    : texts.map(() => true);

  if (texts.length === 0) {
    return Response.json({ error: "未提供待优化块" }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const toOptimizeIndices = texts
          .map((_: string, i: number) => i)
          .filter((i: number) => optimizeMask[i] ?? true);
        if (toOptimizeIndices.length > 0) {
          send(controller, { type: "progress", msg: "正在向量化…" });
        }
        const embeddings = toOptimizeIndices.length > 0
          ? await embedTexts(toOptimizeIndices.map((i: number) => texts[i]))
          : [];
        const embByIndex = new Map<number, number[]>();
        toOptimizeIndices.forEach((idx: number, j: number) => embByIndex.set(idx, embeddings[j]));

        const results: { original: string; similar: SimilarBlock[]; optimized: string }[] = [];
        const optimized: string[] = [];

        for (let i = 0; i < texts.length; i++) {
          send(controller, {
            type: "progress",
            msg: `正在处理第 ${i + 1}/${texts.length} 段…`,
            current: i + 1,
            total: texts.length,
          });
          const chunk = texts[i];
          const shouldOptimize = optimizeMask[i] ?? true;

          if (!shouldOptimize) {
            results.push({ original: chunk, similar: [], optimized: chunk });
            optimized.push(chunk);
            send(controller, { type: "chunk", index: i, data: results[i] });
            continue;
          }

          const emb = embByIndex.get(i);
          const refs = emb ? await searchSimilar(emb, 4) : [];
          const refText = refs.map((r) => r.content).filter(Boolean).join("\n\n---\n\n");

          const userContent = refText
            ? `【参考语料】\n${refText}\n\n【待优化段落】\n${chunk}`
            : `【待优化段落】\n${chunk}`;

          const res = await agent.chat.completions.create({
            model: "deepseek-chat",
            messages: [
              { role: "system", content: OPTIMIZE_PROMPT },
              { role: "user", content: userContent },
            ],
          });
          const opt = res.choices[0].message.content?.trim() || chunk;
          optimized.push(opt);
          results.push({ original: chunk, similar: refs, optimized: opt });
          send(controller, { type: "chunk", index: i, data: results[i] });
        }

        send(controller, { type: "progress", msg: "正在生成 Word 文档…" });
        const doc = new Document({
          sections: [
            {
              children: optimized.map((opt) =>
                new Paragraph({
                  children: opt.split("\n").flatMap((line, i) => [
                    ...(i > 0 ? [new TextRun({ break: 1 })] : []),
                    new TextRun({ text: line || " ", size: 24 }),
                  ]),
                  spacing: { after: 240 },
                })
              ),
            },
          ],
        });
        const buffer = await Packer.toBuffer(doc);
        const base64 = buffer.toString("base64");
        send(controller, {
          type: "result",
          chunks: results,
          optimized,
          docxBase64: base64,
        });
      } catch (e) {
        send(controller, {
          type: "error",
          error: e instanceof Error ? e.message : "优化失败",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
