import { NextRequest } from "next/server";
import { splitIntoParagraphChunks } from "@/lib/pdf-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 仅切分论文，供用户预览、选择、编辑后再优化 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "未提供论文文本" }, { status: 400 });
  }

  try {
    const chunks = await splitIntoParagraphChunks(text);
    return Response.json({ chunks });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "切分失败";
    return Response.json({ error: msg }, { status: 500 });
  }
}
