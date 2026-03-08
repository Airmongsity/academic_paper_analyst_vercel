#!/usr/bin/env node
/**
 * PDF 链接侦察脚本
 * 打开可见浏览器，由你手动点击「全文下载」，脚本监听网络与下载事件以捕获真实 PDF 链接。
 *
 * 用法: node scripts/recon-pdf.mjs [文章页URL]
 * 示例: node scripts/recon-pdf.mjs "https://www.ncpssd.org/Literature/secure/articleinfo?params=xxx&pageUrl=xxx"
 *
 * 若不传 URL，将使用内置示例链接。
 */

import { chromium } from "playwright";
import * as readline from "readline";

const DEFAULT_URL =
  "https://www.ncpssd.org/Literature/secure/articleinfo?params=eHpwKzduYnpKU1lVR2k4azM4bmI1NlJoNVlVYlRVdENpUGZUcnZXNGs0eVBLYzVPRmNUOWpqWHJYbXRFVWVmSmhlUTJPZkZCbHE3R3BhdXFySkVKZ084WUllckozVUpnWk9CdVFjTmxVeWFRVDZEdzUzMGZ1KytLZ3BNUkRJZ3o&pageUrl=https%3A%2F%2Fwww.ncpssd.org%2FLiterature%2Farticlelist";

const articleUrl = process.argv[2]?.trim() || DEFAULT_URL;

console.log("\n========================================");
console.log("  PDF 链接侦察模式");
console.log("========================================");
console.log("\n目标页面:", articleUrl.slice(0, 80) + "...");
console.log("\n请在弹出的浏览器中:");
console.log("  1. 等待页面完全加载");
console.log("  2. 点击「全文下载」按钮");
console.log("  3. 终端将打印捕获到的 PDF 链接与相关网络请求\n");
console.log("按 Enter 键结束侦察并关闭浏览器\n");

const captured = {
  downloads: [],
  ftprpRequests: [],
  pdfNavigations: [],
};

const browser = await chromium.launch({
  headless: false, // 可见窗口，便于手动操作
  slowMo: 0,
  args: ["--start-maximized"],
});

const context = await browser.newContext({
  acceptDownloads: true,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  locale: "zh-CN",
  viewport: null,
});

const page = await context.newPage();

// 1. 监听下载事件（用户点击下载时触发）
page.on("download", (download) => {
  const url = download.url();
  captured.downloads.push(url);
  console.log("\n[下载事件] PDF URL:", url);
  console.log("  建议复制上述 URL 用于后续抓取逻辑\n");
});

// 2. 监听所有请求，记录 ftprp / pdf 相关
page.on("request", (request) => {
  const url = request.url();
  if (url.includes("ftprp") || (url.includes(".pdf") && !url.includes("google"))) {
    captured.ftprpRequests.push({ url, method: request.method() });
    console.log("\n[请求] " + request.method(), url);
  }
});

// 3. 监听响应，记录 PDF 或 ftprp 相关
page.on("response", (response) => {
  const url = response.url();
  const ct = response.headers()["content-type"] || "";
  if (url.includes("ftprp") || ct.includes("application/pdf") || (url.includes(".pdf") && !url.includes("google"))) {
    console.log("\n[响应]", response.status(), url);
    if (ct) console.log("  Content-Type:", ct);
  }
});

// 4. 拦截请求，只打印不修改（便于看到完整 URL）
await page.route("**/*", (route) => route.continue());

await page.goto(articleUrl, {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});

// 等待用户按 Enter 结束
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await new Promise((resolve) => rl.once("line", resolve));
rl.close();

console.log("\n---------- 侦察结果汇总 ----------");
if (captured.downloads.length) {
  console.log("\n[下载 URL] (优先使用):");
  captured.downloads.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
}
if (captured.ftprpRequests.length) {
  console.log("\n[ftprp/pdf 请求]:");
  captured.ftprpRequests.forEach(({ url }, i) => console.log(`  ${i + 1}. ${url}`));
}
console.log("\n");
await browser.close();
