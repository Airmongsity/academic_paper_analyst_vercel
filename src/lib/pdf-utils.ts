import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

/** 从 PDF Buffer 提取纯文本 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const doc = await pdfjsLib.getDocument(new Uint8Array(buffer)).promise;
  let full = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => (item as { str?: string }).str ?? "")
      .join(" ");
    full += pageText + "\n";
  }
  return full;
}

/** 仅删除「整行仅为」页眉页脚的行，避免误删正文中的日期、卷期等 */
const HEADER_FOOTER_LINE_PATTERNS: RegExp[] = [
  /^\s*(Vol\.|No\.|Page)\s*\d+\s*$/i,
  /^\s*\d{4}\s*年\s*\d{1,2}\s*月\s*$/,
  /^\s*第\s*\d+\s*卷\s*$/,
  /^\s*\d+\s*-\s*\d+\s*$/,
  /^\s*\d+\s*$/, // 单行纯页码
  /^\s*国防科技\s*$/,
];

/** 正则清洗：先按行过滤页眉页脚，再合并断行 */
export function cleanPdfText(raw: string): string {
  const lines = raw.split(/\n/);
  const filtered = lines.filter((line) => {
    const t = line.trim();
    if (!t) return false;
    for (const pat of HEADER_FOOTER_LINE_PATTERNS) {
      if (pat.test(t)) return false;
    }
    return true;
  });

  // 合并断行：多个空白变为单个空格，把断句连起来
  return filtered.join(" ").replace(/\s+/g, " ").trim();
}

/** 使用 RecursiveCharacterTextSplitter 切分，chunkSize 800, chunkOverlap 150 */
export async function splitIntoChunks(text: string): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 800,
    chunkOverlap: 150,
  });
  return splitter.splitText(text);
}
