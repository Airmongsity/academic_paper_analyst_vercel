import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { embedTexts } from "@/lib/embedding";

export const runtime = "nodejs";
export const maxDuration = 120;

type ChunkInput = {
  content: string;
  metadata?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const chunks = (body.chunks ?? []) as ChunkInput[];

  if (chunks.length === 0) {
    return Response.json({ error: "未提供语料块" }, { status: 400 });
  }

  const texts = chunks.map((c) => c.content?.trim() ?? "").filter(Boolean);
  if (texts.length === 0) {
    return Response.json({ error: "无有效文本" }, { status: 400 });
  }

  try {
    const embeddings = await embedTexts(texts);

    const rows = texts.map((content, i) => ({
      content,
      metadata: chunks[i]?.metadata ?? {},
      embedding: embeddings[i],
    }));

    const { error } = await supabase.from("documents").insert(rows);

    if (error) {
      return Response.json(
        { error: `Supabase 写入失败: ${error.message}` },
        { status: 500 }
      );
    }

    return Response.json({ success: true, inserted: rows.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "向量化失败";
    return Response.json({ error: msg }, { status: 500 });
  }
}
