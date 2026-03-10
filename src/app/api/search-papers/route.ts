import { NextRequest, NextResponse } from "next/server";
import { getJson } from "serpapi";
import * as cheerio from "cheerio";

export const runtime = "nodejs";

/** 统一论文项：前端和 SerpApi / NCPSSD 都使用这一结构 */
export type PaperItem = {
  title: string;
  link: string;
  snippet: string;
  publicationInfo: string;
  pdfUrl: string;
  source: "scholar" | "ncpssd";
  /** 部分站点（如 academia.edu）需登录才能下载 */
  requiresLogin?: boolean;
};

const NCPSSD_BASE = process.env.NCPSSD_BASE ?? "https://www.ncpssd.org";
const NCPSSD_ARTICLE_LIST_PATH = "/Literature/articlelist";

function toBase64Utf8(input: string): string {
  return Buffer.from(input, "utf8").toString("base64");
}

function buildNcpssdSearchExpr(keywords: string): string {
  return `(IKTE="${keywords}" OR IKPYTE="${keywords}" OR IKST="${keywords}" OR IKET="${keywords}" OR IKSE="${keywords}")`;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, "").trim();
}

async function searchNcpssd(keywords: string): Promise<PaperItem[]> {
  const searchExpr = buildNcpssdSearchExpr(keywords);
  const searchName = `题名/关键词="${keywords}"`;
  const articleListUrl = `${NCPSSD_BASE}${NCPSSD_ARTICLE_LIST_PATH}?sType=0&search=${encodeURIComponent(
    toBase64Utf8(searchExpr)
  )}&searchname=${encodeURIComponent(toBase64Utf8(searchName))}&nav=0&ajaxKeys=${encodeURIComponent(
    toBase64Utf8(keywords)
  )}`;

  // 先请求 articlelist 获取会话，再请求真实搜索接口
  const landing = await fetch(articleListUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });

  if (!landing.ok) return [];

  const cookie = landing.headers.get("set-cookie") ?? "";
  const form = new URLSearchParams();
  form.set("search", searchExpr);
  form.set("pageNum", "1");
  form.set("pageSize", "10");
  form.set("sort", "synUpdateType|DESC,date|DESC,ik_subject|DESC,id|DESC");
  form.set("sType", "0");
  form.set("ajaxKeys", keywords);
  form.set("customShowCondition", searchName);

  const searchRes = await fetch(`${NCPSSD_BASE}/searchHandler/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: articleListUrl,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: form.toString(),
  });

  if (!searchRes.ok) return [];

  interface NcpssdRow {
    ik_title?: string;
    title?: string;
    ik_remark?: string;
    remark?: string;
    cbw_name?: string;
    years?: string;
    type?: string;
    pdfurl?: string;
    encryptedUrl?: string;
    data_id?: string;
    tab_name?: string;
    HtmlUrl?: string;
    htmlUrl?: string;
  }

  interface NcpssdSearchResult {
    data?: {
      rows?: NcpssdRow[];
    };
  }

  const json = (await searchRes.json()) as NcpssdSearchResult;
  const rows = json?.data?.rows ?? [];
  if (rows.length === 0) return [];

  // 首选接口 rows，若为空再回退 HTML 解析
  const apiPapers: PaperItem[] = rows.map((row) => {
    const titleRaw = row.ik_title || row.title || "";
    const title = stripHtml(titleRaw);
    const snippet = stripHtml(row.ik_remark || row.remark || "").slice(0, 220);
    const publicationInfo = [row.cbw_name, row.years ? `${row.years}年` : "", row.type]
      .filter(Boolean)
      .join(" | ");
    const secureLink = row.encryptedUrl
      ? `${NCPSSD_BASE}/Literature/secure/articleinfo?params=${encodeURIComponent(
          row.encryptedUrl
        )}&pageUrl=${encodeURIComponent(articleListUrl)}`
      : articleListUrl;
    return {
      title,
      link: secureLink,
      snippet,
      publicationInfo,
      pdfUrl: (row.pdfurl ?? (row as Record<string, unknown>).pdfUrl ?? "") as string,
      source: "ncpssd",
    };
  });

  // 不再在此处等待 PDF 抓取，由前端按需调用 /api/fetch-pdf-url 异步补全
  if (apiPapers.length > 0) {
    return apiPapers.slice(0, 10);
  }

  const html = await landing.text();
  const $ = cheerio.load(html);

  const papers: PaperItem[] = [];

  // 常见结果列表选择器（按实际页面结构调整）
  const selectors = [
    ".search-result-list .item",
    ".result-list li",
    ".list-content .item",
    "ul.search-list > li",
    ".article-list .article-item",
    "[class*='result'] [class*='item']",
  ];

  let $items = $(selectors[0]);
  for (const sel of selectors) {
    $items = $(sel);
    if ($items.length > 0) break;
  }

  $items.each((_: number, el) => {
    const $el = $(el);
    const $link = $el.find("a[href*='Article'], a[href*='article'], a[href*='detail']").first();
    const href = $link.attr("href");
    const title = $link.text().trim() || $el.find("h3, .title").first().text().trim();
    if (!href || !title) return;

    const link = href.startsWith("http") ? href : new URL(href, NCPSSD_BASE).href;
    const snippet = $el.find(".abstract, .snippet, .summary, [class*='desc']").first().text().trim();
    const publicationInfo = $el.find(".source, .journal, .meta, [class*='pub']").first().text().trim();
    const $pdf = $el.find("a[href*='.pdf'], a[href*='pdf']").first();
    let pdfUrl = $pdf.attr("href")?.trim() || "";
    if (pdfUrl && !pdfUrl.startsWith("http")) {
      try {
        pdfUrl = new URL(pdfUrl, NCPSSD_BASE).href;
      } catch {
        pdfUrl = "";
      }
    }

    papers.push({
      title,
      link,
      snippet,
      publicationInfo,
      pdfUrl: pdfUrl || "",
      source: "ncpssd",
    });
  });

  // 若上面选择器都没匹配到，尝试按“任意文章链接”抓取（兜底）
  if (papers.length === 0) {
    $(`a[href*='Article'], a[href*='article'], a[href*='Detail']`).each((_: number, el) => {
      const $a = $(el);
      const href = $a.attr("href");
      const title = $a.text().trim();
      if (!href || !title || title.length < 4) return;
      const link = href.startsWith("http") ? href : new URL(href, NCPSSD_BASE).href;
      papers.push({
        title,
        link,
        snippet: "",
        publicationInfo: "",
        pdfUrl: "",
        source: "ncpssd",
      });
    });
  }

  return papers.slice(0, 10);
}

async function searchScholar(keywords: string, apiKey: string): Promise<PaperItem[]> {
  interface SerpApiScholarResult {
    organic_results?: Array<{
      title?: string;
      link?: string;
      snippet?: string;
      publication_info?: { summary?: string };
      resources?: Array<{ file_format?: string; link?: string }>;
    }>;
  }

  const result = await new Promise<SerpApiScholarResult>((resolve) => {
    getJson(
      {
        api_key: apiKey,
        engine: "google_scholar",
        q: keywords,
        hl: "en",
        num: 10,
      },
      (json: SerpApiScholarResult) => resolve(json)
    );
  });

  const REQUIRE_LOGIN_DOMAINS = /academia\.edu|researchgate\.net/i;
  const list = result?.organic_results || [];
  const items: PaperItem[] = list.map((item) => {
    const pdfResource = (item.resources || []).find((r) => r.file_format === "PDF");
    const pdfUrl = (pdfResource?.link as string) ?? "";
    const requiresLogin = !!pdfUrl && REQUIRE_LOGIN_DOMAINS.test(pdfUrl);
    return {
      title: (item.title as string) || "",
      link: (item.link as string) || "",
      snippet: (item.snippet as string) ?? "",
      publicationInfo: (item.publication_info?.summary as string) ?? "",
      pdfUrl,
      source: "scholar" as const,
      requiresLogin,
    };
  });
  // 可下载的排前（有 pdfUrl 且无需登录），需登录的次之，无 PDF 的排后
  return items.sort((a, b) => {
    const aScore = a.pdfUrl ? (a.requiresLogin ? 1 : 2) : 0;
    const bScore = b.pdfUrl ? (b.requiresLogin ? 1 : 2) : 0;
    return bScore - aScore;
  });
}

export async function POST(req: NextRequest) {
  let body: { keywords?: string; source?: "scholar" | "ncpssd" | "all" } = {};

  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON body", { status: 400 });
  }

  const keywords = body.keywords?.trim();
  if (!keywords) {
    return new NextResponse("Missing keywords", { status: 400 });
  }

  const source = body.source ?? "all";
  const papers: PaperItem[] = [];
  const tasks: Promise<void>[] = [];

  if (source === "scholar" || source === "all") {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (apiKey) {
      tasks.push(
        searchScholar(keywords, apiKey)
          .then((scholarPapers) => {
            papers.push(...scholarPapers);
          })
          .catch((e) => {
            console.error("SerpApi search error:", e);
          })
      );
    }
  }

  if (source === "ncpssd" || source === "all") {
    tasks.push(
      searchNcpssd(keywords)
        .then((ncpssdPapers) => {
          papers.push(...ncpssdPapers);
        })
        .catch((e) => {
          console.error("NCPSSD search error:", e);
        })
    );
  }

  await Promise.all(tasks);

  console.log(`[search-papers] source=${source} keywords="${keywords}" 返回 ${papers.length} 篇`);
  return NextResponse.json({ ok: true, papers });
}
