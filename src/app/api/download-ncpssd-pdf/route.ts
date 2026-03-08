import { NextRequest, NextResponse } from "next/server";
import { fetchPdfBlob } from "@/lib/ncpssd-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 后端代理：用 Playwright 抓取 NCPSSD PDF 并返回给用户，绕过 403 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }
    if (!url.startsWith("https://www.ncpssd.org/") && !url.startsWith("http://www.ncpssd.org/")) {
      return NextResponse.json({ error: "Invalid domain" }, { status: 400 });
    }

    const buf = await fetchPdfBlob(url);
    if (!buf || buf.length === 0) {
      return NextResponse.json({ error: "Failed to fetch PDF" }, { status: 502 });
    }

    const filename = "paper.pdf";
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
