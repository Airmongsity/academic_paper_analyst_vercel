import { NextRequest } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 120;

function getAgent() {
  const key = process.env.DEEPSEEK_API_KEY ?? "";
  if (!key) throw new Error("未配置 DEEPSEEK_API_KEY");
  return new OpenAI({ apiKey: key, baseURL: "https://api.deepseek.com" });
}

type ChunkItem = { paperIndex: number; chunkIndex: number; content: string; title?: string };

const BATCH_SIZE = 20;

/** 语料分析员：判断每个块是否有价值存入语料库 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const items = (body.items ?? []) as ChunkItem[];
  if (items.length === 0) {
    return Response.json({ results: [] });
  }

  const agent = getAgent();
  const results: { paperIndex: number; chunkIndex: number; valid: boolean; reason?: string }[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const prompt = `你是一位语料分析员。以下是从学术论文中提取的文本块，请判断每个块是否有价值存入语料库用于后续检索与参考。

无效块包括：未能正确识别的公式、乱码、纯数字/符号、页眉页脚、无意义的短句、目录项、图表说明残留、明显破损的句子等。
有效块应为：连贯的学术表述、完整段落、有实质内容的叙述。

请严格返回 JSON 数组，每项格式：{"i": 序号(从0起,对应下面列表), "valid": true或false, "reason": "简短原因(仅当valid为false时)"}
序号对应下面每条的前缀 [0]、[1] 等。

文本块列表：
${batch.map((it, idx) => `[${idx}] ${it.content.slice(0, 600)}${it.content.length > 600 ? "…" : ""}`).join("\n\n")}`;

    try {
      const res = await agent.chat.completions.create({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      });
      const raw = res.choices?.[0]?.message?.content?.trim() ?? "";
      let arr: { i?: number; valid?: boolean; reason?: string }[] = [];
      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) arr = JSON.parse(jsonMatch[0]) as typeof arr;
      } catch {
        /* ignore parse error */
      }
      for (const x of arr) {
        const idx = Number(x.i);
        if (idx >= 0 && idx < batch.length) {
          const it = batch[idx];
          results.push({
            paperIndex: it.paperIndex,
            chunkIndex: it.chunkIndex,
            valid: !!x.valid,
            reason: x.reason,
          });
        }
      }
    } catch (e) {
      console.error("[analyze-corpus-ai] batch error:", e);
      for (const it of batch) {
        results.push({ paperIndex: it.paperIndex, chunkIndex: it.chunkIndex, valid: true });
      }
    }
  }

  return Response.json({ results });
}
