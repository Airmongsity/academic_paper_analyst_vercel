import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import OpenAI from "openai";
import { extractTextFromPdf, cleanPdfText } from "@/lib/pdf-utils";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 延迟初始化，构建时 env 不可用 */
function getAgent() {
  const key = process.env.DEEPSEEK_API_KEY ?? "";
  if (!key) throw new Error("未配置 DEEPSEEK_API_KEY");
  return new OpenAI({ apiKey: key, baseURL: "https://api.deepseek.com" });
}

const KEYWORDS_PROMPT = `
You're a helpful assistant that get keywords from text;
Use professional English and only return keywords in the response text.
the keywords should correspond to similar papers, allowing users to find similar papers by searching for those keywords.
response text must NOT exceed 6 words
但是如果论文是中文, 则须返回1个精炼的中文关键词, 不超过6个字符, 且不能含有分隔符, 否则会被认为是多个关键词
例如"农业合作化"、"民族认同"、"抗战创伤记忆"等是合法关键词, 而"突尼斯民族身份"、"战争与创伤记忆"是非法关键词
`;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  let text = "";
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = (file as File).name?.toLowerCase() ?? "";
  const isDocx = name.endsWith(".docx") || file.type?.includes("wordprocessingml");

  try {
    if (isDocx) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value?.trim() ?? "";
    } else {
      text = cleanPdfText(await extractTextFromPdf(buffer), { removeFormulas: false });
    }
  } catch (error) {
    console.error("Error parsing file:", error);
    const msg = error instanceof Error ? error.message : "解析文件失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!text.trim()) {
    return NextResponse.json({ error: "未提取到有效文本" }, { status: 400 });
  }

  try {
    const response = await getAgent().chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: KEYWORDS_PROMPT },
        { role: "user", content: text },
      ],
    });
    const keywords = response.choices[0].message.content?.trim() || "";
    return NextResponse.json({ ok: true, text, keywords });
  } catch (error) {
    console.error("Error getting keywords:", error);
    const msg = error instanceof Error ? error.message : "Error getting keywords";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
