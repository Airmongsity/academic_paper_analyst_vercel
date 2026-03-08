import { NextRequest, NextResponse } from "next/server";
import { fetchPdfUrl } from "@/lib/ncpssd-pdf";

export const runtime = "nodejs";

/** 从 NCPSSD 文章页 URL 抓取 PDF 下载链接，供前端按需异步调用 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json({ pdfUrl: "" }, { status: 400 });
    }
    // 仅允许 ncpssd.org 域名，防止 SSRF
    if (!url.startsWith("https://www.ncpssd.org/") && !url.startsWith("http://www.ncpssd.org/")) {
      return NextResponse.json({ pdfUrl: "" }, { status: 400 });
    }
    const pdfUrl = await fetchPdfUrl(url);
    return NextResponse.json({ pdfUrl });
  } catch {
    return NextResponse.json({ pdfUrl: "" }, { status: 500 });
  }
}
