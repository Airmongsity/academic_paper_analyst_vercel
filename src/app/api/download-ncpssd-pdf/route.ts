import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** 构建时兜底：Vercel 构建可能触发路由，直接返回占位响应，不加载 Playwright */
const isBuildPhase = process.env.VERCEL === "1" && process.env.NEXT_PHASE === "phase-production-build";

/** 后端代理：用 Playwright 抓取 NCPSSD PDF 并返回给用户，绕过 403 */
export async function POST(req: NextRequest) {
  try {
    if (isBuildPhase) {
      const emptyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF 最小占位
      return new NextResponse(emptyPdf, {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="paper.pdf"' },
      });
    }

    const body = await req.json();
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });
    if (!url.startsWith("https://www.ncpssd.org") && !url.startsWith("http://www.ncpssd.org")) {
      return NextResponse.json({ error: "Invalid domain" }, { status: 400 });
    }

    const { fetchPdfBlob } = await import("@/lib/ncpssd-pdf");
    const buf = await fetchPdfBlob(url);
    if (!buf || buf.length === 0) {
      return NextResponse.json({ error: "Failed to fetch PDF" }, { status: 502 });
    }

    const filename = "paper.pdf";
    // Buffer 不能直接作为 NextResponse body，转换为 Uint8Array 符合 Web API BodyInit
    const pdfBytes = Uint8Array.from(buf as Iterable<number>);
    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBytes.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
