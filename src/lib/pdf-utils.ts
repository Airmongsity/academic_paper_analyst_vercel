import { getDocument } from "pdfjs-serverless";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

/** 从 PDF Buffer 提取纯文本（使用 pdfjs-serverless，兼容 Vercel 等 serverless） */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  let full = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => (item as { str?: string }).str ?? "")
      .join(" ");
    full += pageText + "\n";
  }
  return full.trim();
}

/** 仅删除「整行仅为」页眉页脚的行 */
const HEADER_FOOTER_LINE_PATTERNS: RegExp[] = [
  /^\s*(Vol\.|No\.|Page)\s*\d+\s*$/i,
  /^\s*\d{4}\s*年\s*\d{1,2}\s*月\s*$/,
  /^\s*第\s*\d+\s*卷\s*$/,
  /^\s*\d+\s*-\s*\d+\s*$/,
  /^\s*\d+\s*$/, // 纯页码
  /^\s*国防科技\s*$/,
];

/** 公式相关行（Equation、Eq.、公式 等），中英文 */
const FORMULA_LINE_PATTERNS: RegExp[] = [
  /^\s*(\[公式\]\s*)*\s*$/, // 仅含占位符的行
  /^\s*\(?\s*\d+(?:\.\d+)*\s*\)?\s*$/, // (1), (2.1) 独立成行
  /^\s*(Eq\.?|Equation|公式)\s*[0-9.]+\s*$/i,
  /^\s*\\\[[\s\S]*\\\]\s*$/, // \[ ... \]
  /^\s*\\\([\s\S]*\\\)\s*$/, // \( ... \)
  /^\s*[=\+\-\*\/\^\(\)\[\]\d\s]{3,}$/, // 仅含运算符和数字的行（疑似公式）
];

const FORMULA_PLACEHOLDER = "[公式]";
/** 用于正则的转义版本，避免 [ ] 被当成字符类 */
const FORMULA_PLACEHOLDER_ESC = "[公式]".replace(/[[\]]/g, "\\$&");

/** 希腊字母（含扩展）、数学符号等应清洗的字符集 */
const FORMULA_CHARS =
  /[\u0370-\u03FF\u1F00-\u1FFF\u2100-\u214F\u2190-\u21FF\u2200-\u22FF\u2500-\u257F\u27E0-\u27EF\u3008-\u3009\uFF04]/u;

/** 删除文本中的公式内容，用 [公式] 占位符替代 */
function removeFormulas(text: string): string {
  let s = text;
  const ph = () => ` ${FORMULA_PLACEHOLDER} `;

  // LaTeX 块级与内联
  s = s.replace(/\$\$[\s\S]*?\$\$/g, ph());
  s = s.replace(/\$[^$\n]+\$/g, ph());
  s = s.replace(/\\\[[\s\S]*?\\\]/g, ph());
  s = s.replace(/\\\([\s\S]*?\\\)/g, ph());

  // Dirac / ket：|...〉、│...〉（│ 为 PDF 常用竖线）
  s = s.replace(/[|│][^〉⟩]*?[〉⟩]/g, ph());
  s = s.replace(/[〈⟨][^|│]*?[|│]/g, ph());
  s = s.replace(/[|│]\s*[^\s\u4e00-\u9fff]*(?=[\s,，。.、和与及]|$)/g, ph()); // │ C 、│ D 、│0 等
  s = s.replace(/[|〉〈⟩⟨│]+/g, ph());
  // Pauli 矩阵 σx σy σz
  s = s.replace(/σ\s*[xyz]/gi, ph());
  // 张量积 A ⊗ B
  s = s.replace(/[^\s\,\。，．]+(?:\s*⊗\s*[^\s\,\。，．]+)+/g, ph());
  s = s.replace(/⊗/g, ph());
  // 量子态 ψs ψf 等
  s = s.replace(/\s*ψ\s*[a-z](?=[\s\)\.，。]|$)/gi, ph());
  // 公式编号 (11) (12)……
  s = s.replace(/\s*\(\d{1,3}\)\s*(?=[。，\.\,]|$)/g, ph());
  s = s.replace(/\s*\(\d{1,3}\)\s*\./g, ph());
  // 盒型/占位符
  s = s.replace(/[■□▪▫●◦]/g, ph());
  // 公式残片
  s = s.replace(/=\s*[|│]|=\s*[\d\s\+\-\*\/i\.]{2,}(?=[\s\,\.。，]|$)/g, ph());
  s = s.replace(/\(\s*\)/g, ph());
  s = s.replace(/[A-Za-z]\s*-\s*1(?=\s*[|│\+\-=]|\s*[〈⟨])/g, ph());
  s = s.replace(/\b[A-Z]\s+\d+\s+[A-Z]\b/g, ph());
  // 2×2 矩阵元素 ( 0 1 0 1 + i 等
  s = s.replace(/\(\s*[01]\s+[01]\s+[01]\s+[01]\s*[+\-i\]]/g, ph());
  s = s.replace(/\[\s*[01]\s+[01]\s+[01]\s+[01]\s*[+\-i\])]/g, ph());
  // 虚数单位 i 与数字 ( 如 + i 2、- i )
  s = s.replace(/[+\-]\s*i\s*\d/g, ph());
  // 含 + - * / 的表达式（如 a + b、1/2、x - y）
  s = s.replace(/[^\s,，。、]+(?:\s*[+\-*/]\s*[^\s,，。、]+)+/g, ph());

  // 希腊字母与数学符号：连续出现的公式字符整块替换为占位符
  s = s.replace(new RegExp(`(${FORMULA_CHARS.source})+`, "gu"), ph());

  // 合并连续占位符：反复执行直到收敛
  const esc = FORMULA_PLACEHOLDER_ESC;
  const mergeStep = () => {
    // 1. 去掉 [公式] 外的冗余 [ ] 和 ( )
    s = s.replace(new RegExp(`\\[\\s*${esc}\\s*\\]`, "g"), ph());
    s = s.replace(new RegExp(`\\(\\s*${esc}\\s*\\)`, "g"), ph());
    // 2. 合并 [公式] 、 [公式] 或 [公式] = [公式] 等（含 [ ] ( ) ·）
    s = s.replace(new RegExp(`${esc}(?:\\s*[、=，．·\\[\\]()]\\s*${esc})*`, "g"), ph());
    // 3. 合并 [公式] 0 [公式] 或 [公式] 1 [公式]（常见矩阵元素）
    s = s.replace(new RegExp(`${esc}\\s*[01]\\s*${esc}`, "g"), ph());
    // 4. 合并仅由空格分隔的连续 [公式]
    s = s.replace(new RegExp(`(\\s*${esc}\\s*)+`, "g"), ` ${FORMULA_PLACEHOLDER} `);
    // 5. 孤立 ] 或 [ 紧邻 [公式] 时一并合并
    s = s.replace(new RegExp(`\\]\\s*\\[\\s*${esc}\\s*\\]`, "g"), ph());
    s = s.replace(new RegExp(`\\[\\s*${esc}\\s*\\]\\s*\\[`, "g"), ph());
  };
  let prev = "";
  for (let i = 0; i < 20; i++) {
    if (prev === s) break;
    prev = s;
    mergeStep();
  }
  return s.replace(/\s+/g, " ").trim();
}

export type CleanPdfOptions = { removeFormulas?: boolean };

/** 正则清洗：过滤页眉页脚、公式行；可选是否去除公式内容（用户论文保留公式） */
export function cleanPdfText(raw: string, options: CleanPdfOptions = {}): string {
  const { removeFormulas: doRemoveFormulas = true } = options;
  const s = doRemoveFormulas ? removeFormulas(raw) : raw;
  const lines = s.split(/\n/);
  const filtered = lines.filter((line) => {
    const t = line.trim();
    if (!t) return false;
    for (const pat of HEADER_FOOTER_LINE_PATTERNS) {
      if (pat.test(t)) return false;
    }
    for (const pat of FORMULA_LINE_PATTERNS) {
      if (pat.test(t)) return false;
    }
    return true;
  });
  return filtered.join(" ").replace(/\s+/g, " ").trim();
}

/** 清洗空格：合并连续空白、去除首尾空格（语料库解析时使用） */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export type SplitOptions = {
  /** 最大切分字符（超过则强制切块） */
  maxChunkSize?: number;
  /** 最小连续字符（低于则与下一块合并） */
  minChunkSize?: number;
};

const DEFAULT_MAX_CHUNK = 800;
const DEFAULT_MIN_CHUNK = 280;

/** 使用 RecursiveCharacterTextSplitter 切分（语料库用） */
export async function splitIntoChunks(text: string, options: SplitOptions = {}): Promise<string[]> {
  const maxChunk = options.maxChunkSize ?? DEFAULT_MAX_CHUNK;
  const minChunk = options.minChunkSize ?? DEFAULT_MIN_CHUNK;
  const overlap = Math.min(150, Math.floor(maxChunk * 0.2));
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: maxChunk,
    chunkOverlap: overlap,
  });
  const raw = await splitter.splitText(text);
  return mergeSmallChunks(raw, minChunk);
}

function mergeSmallChunks(chunks: string[], minSize: number): string[] {
  if (chunks.length <= 1 || minSize <= 0) return chunks;
  const result: string[] = [];
  let i = 0;
  while (i < chunks.length) {
    let acc = chunks[i];
    while (acc.length < minSize && i + 1 < chunks.length) {
      i++;
      acc += "\n\n" + chunks[i];
    }
    result.push(acc);
    i++;
  }
  return result;
}

/** 疑似目录行：短行且以数字/点开头（如 "1. 引言" "2.2. 方法" "3 文献综述"） */
function looksLikeTocLine(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length < 80 && /^\d+(\.\d*\.?)?\s+[^\s\d]/.test(t);
}

/** 段落优先切分（用户论文用）：优先在章节号、双换行处分段，合并过小块，目录整块保留 */
export async function splitIntoParagraphChunks(text: string, options: SplitOptions = {}): Promise<string[]> {
  const maxChunk = options.maxChunkSize ?? DEFAULT_MAX_CHUNK;
  const minChunk = options.minChunkSize ?? DEFAULT_MIN_CHUNK;
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: maxChunk,
    chunkOverlap: Math.min(80, Math.floor(maxChunk * 0.1)),
    separators: [
      "\n\n", // 双换行（段落）
      "\n",   // 单换行
      "。",
      "！",
      "？",
      ".",
      " ",
      "",
    ],
  });

  const lines = text.split(/\n/);
  let parts: string[] = [];

  // 0. 先合并连续目录行为一块（避免目录被切得过碎）
  const merged: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (looksLikeTocLine(lines[i])) {
      const tocLines: string[] = [];
      while (i < lines.length && (looksLikeTocLine(lines[i]) || (lines[i].trim() === "" && tocLines.length > 0))) {
        if (lines[i].trim()) tocLines.push(lines[i].trim());
        i++;
      }
      if (tocLines.length > 0) merged.push(tocLines.join("\n"));
    } else {
      merged.push(lines[i]);
      i++;
    }
  }
  const preText = merged.join("\n");

  // 1. 优先按章节号（如 1. 2.1. 2.2.）分块
  const sectionRegex = /(?=\n\s*\d+\.\d*\.?\s+[^\s\d\.])|(?<=\s)(?=\d+\.\d*\.?\s+[^\s\d\.])/g;
  const bySection = preText.split(sectionRegex).map((s) => s.trim()).filter(Boolean);

  if (bySection.length > 1) {
    parts = bySection;
  } else {
    const byParagraph = preText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    parts = byParagraph.length > 1 ? byParagraph : [preText];
  }

  const raw: string[] = [];
  for (const p of parts) {
    if (p.length <= maxChunk) {
      raw.push(p);
    } else {
      const sub = await splitter.splitText(p);
      raw.push(...sub);
    }
  }

  // 合并过小的块（与下一块合并，目录块除外）
  const result: string[] = [];
  i = 0;
  while (i < raw.length) {
    let acc = raw[i];
    const isToc = acc.split(/\n/).every((l) => looksLikeTocLine(l) || !l.trim());
    while (
      !isToc &&
      acc.length < minChunk &&
      i + 1 < raw.length
    ) {
      i++;
      acc += "\n\n" + raw[i];
    }
    result.push(acc);
    i++;
  }
  return result;
}

/** 语言字符（中文、英文字母）的正则 */
const LANG_CHAR = /[\u4e00-\u9fff\u3400-\u4dbfa-zA-Z]/g;

/** 判断语料块是否为以语言为主（中文+英文 ≥ 2/3），否则视为非语言比例过多 */
export function isChunkLinguistic(text: string): boolean {
  const t = text.trim();
  if (!t.length) return false;
  const matches = t.match(LANG_CHAR);
  const langCount = matches ? matches.length : 0;
  const total = t.length;
  return total > 0 && langCount / total >= 2 / 3;
}
