import * as cheerio from "cheerio";
import { chromium } from "playwright";

const NCPSSD_BASE = process.env.NCPSSD_BASE ?? "https://www.ncpssd.org";

/** NCPSSD 实际 PDF 域名：ft.ncpssd.cn 或 ftprp.ncpssd.cn（侦察确认） */
const PDF_DOMAIN = /ft\.ncpssd\.cn|ftprp\.ncpssd\.cn/;

/** 使用 Playwright 模拟点击「全文下载」，从响应中捕获 PDF URL（点击后发起 GET，不触发 download 事件） */
async function fetchPdfUrlWithPlaywright(articleUrl: string): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "zh-CN",
    });
    const page = await context.newPage();

    // 侦察结果：点击后发起 GET 请求到 ft.ncpssd.cn/pdf/xxx.pdf，用 waitForResponse 捕获
    const responsePromise = page.waitForResponse(
      (resp) => {
        const url = resp.url();
        const ct = resp.headers()["content-type"] || "";
        return (
          (PDF_DOMAIN.test(url) || url.endsWith(".pdf")) &&
          (url.includes("/pdf/") || ct.includes("application/pdf"))
        );
      },
      { timeout: 20000 }
    );

    await page.goto(articleUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    const btn = page.getByText("全文下载").first();
    await btn.waitFor({ state: "visible", timeout: 10000 });
    await btn.click();

    const response = await responsePromise;
    const pdfUrl = response.url();
    return pdfUrl && PDF_DOMAIN.test(pdfUrl) ? pdfUrl : "";
  } catch {
    return "";
  } finally {
    await browser.close();
  }
}

/** 从 NCPSSD 文章详情页提取 PDF 下载链接（静态 HTML） */
export async function fetchPdfUrlFromArticlePage(
  articleUrl: string,
  cookie = ""
): Promise<string> {
  try {
    const res = await fetch(articleUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: `${NCPSSD_BASE}/Literature/articlelist`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    if (!res.ok) return "";
    const html = await res.text();
    const $ = cheerio.load(html);

    const pageUrl = $("#ftl_urlPageUrl").attr("value")?.trim();
    if (pageUrl && (PDF_DOMAIN.test(pageUrl) || pageUrl.includes(".pdf") || pageUrl.startsWith("http"))) {
      return pageUrl.startsWith("http") ? pageUrl : new URL(pageUrl, NCPSSD_BASE).href;
    }

    const $aDown = $("#a_down, a[id='a_down'], a.all-down");
    if ($aDown.length) {
      const href = $aDown.attr("href")?.trim();
      if (href && !href.startsWith("javascript:") && !href.startsWith("blob:") && (href.includes("pdf") || PDF_DOMAIN.test(href))) {
        return href.startsWith("http") ? href : new URL(href, NCPSSD_BASE).href;
      }
      const dataHref = $aDown.attr("data-href") || $aDown.attr("data-url") || $aDown.attr("data-pdf-url");
      if (dataHref) {
        return dataHref.startsWith("http") ? dataHref : new URL(dataHref, NCPSSD_BASE).href;
      }
      const onclick = $aDown.attr("onclick") || "";
      const urlMatch = onclick.match(/https?:\/\/(?:ft|ftprp)\.ncpssd\.cn[^\s'")]*|https?:\/\/[^\s'"]+\.pdf[^\s'")]*/);
      if (urlMatch) return urlMatch[0];
    }

    const pdfMatch = html.match(/https:\/\/(?:ft|ftprp)\.ncpssd\.cn\/pdf\/[^\s"'<>)\]]+/);
    if (pdfMatch) return pdfMatch[0];

    const valMatch = html.match(/value=["'](https:\/\/(?:ft|ftprp)\.ncpssd\.cn[^"']+)["']/);
    if (valMatch) return valMatch[1];

    const scriptMatch = html.match(/(?:pdfUrl|pageUrl|pdfurl)\s*[:=]\s*["'](https:\/\/(?:ft|ftprp)\.ncpssd\.cn[^"']+)["']/i);
    if (scriptMatch) return scriptMatch[1];

    return "";
  } catch {
    return "";
  }
}

/** 主入口：先尝试静态解析，失败则用 Playwright 模拟点击下载 */
export async function fetchPdfUrl(articleUrl: string): Promise<string> {
  const fromStatic = await fetchPdfUrlFromArticlePage(articleUrl, "");
  if (fromStatic) return fromStatic;
  return fetchPdfUrlWithPlaywright(articleUrl);
}

/** 用 Playwright 抓取 PDF 内容并返回 Buffer（供后端代理下载，绕过 403） */
export async function fetchPdfBlob(articleUrl: string, maxRetries = 2): Promise<Buffer | null> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headed = process.env.NCPSSD_PDF_HEADED === "1" || process.env.NCPSSD_PDF_HEADED === "true";
    const browser = await chromium.launch({
      headless: !headed,
      slowMo: headed ? 80 : 0,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        locale: "zh-CN",
      });
      const page = await context.newPage();

      await page.goto(articleUrl, {
        waitUntil: "domcontentloaded",
        timeout: 40000,
      });
      await new Promise((r) => setTimeout(r, 2000));

      let btn = page.getByText("全文下载").first();
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        const inFrame = frame.getByText("全文下载").first();
        if (await inFrame.isVisible().catch(() => false)) {
          btn = inFrame;
          break;
        }
      }

      await btn.waitFor({ state: "visible", timeout: 12000 });

      const responsePromise = page.waitForResponse(
        (resp) => {
          const url = resp.url();
          const ct = resp.headers()["content-type"] || "";
          return (
            resp.request().method() === "GET" &&
            resp.status() === 200 &&
            (PDF_DOMAIN.test(url) || url.endsWith(".pdf")) &&
            (url.includes("/pdf/") || ct.includes("application/pdf"))
          );
        },
        { timeout: 25000 }
      );

      await btn.click();

      const response = await responsePromise;
      const buf = await response.body();
      return Buffer.from(buf);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.error(`[fetchPdfBlob] 第 ${attempt + 1} 次失败:`, lastError.message);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    } finally {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}
