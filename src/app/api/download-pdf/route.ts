import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 允许代理下载的 PDF 域名（借鉴 platform，仅学术来源） */
const ALLOWED_HOSTS = [
  "arxiv.org",
  "export.arxiv.org",
  "link.springer.com",
  "dl.acm.org",
  "ieeexplore.ieee.org",
  "sciencedirect.com",
  "pdfs.semanticscholar.org",
  "semanticscholar.org",
  "biorxiv.org",
  "medrxiv.org",
  "core.ac.uk",
  "citeseerx.ist.psu.edu",
  "europepmc.org",
  "ncbi.nlm.nih.gov",
  "mdpi.com",
  "hindawi.com",
  "frontiersin.org",
  "plos.org",
  "nature.com",
  "science.org",
  "cell.com",
  "cambridge.org",
  "tandfonline.com",
  "wiley.com",
  "zenodo.org",
  "osf.io",
  "unpaywall.org",
  "doi.org",
  "dblp.org",
];

function isAllowedUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

/** 代理下载 PDF（借鉴 platform /api/download），规避 CORS / 403 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const filename = req.nextUrl.searchParams.get("filename") || "paper.pdf";

  if (!url?.startsWith("http")) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (!isAllowedUrl(url)) {
    return NextResponse.json({ error: "Domain not allowed" }, { status: 403 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/pdf,*/*",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Fetch failed: ${res.status}` }, { status: 502 });
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("pdf") && !ct.includes("octet-stream")) {
      return NextResponse.json({ error: "Not a PDF" }, { status: 400 });
    }

    const buf = await res.arrayBuffer();
    const body = new Uint8Array(buf);
    const safeName = filename.replace(/[^\w\u4e00-\u9fff\-\.]/g, "_").slice(0, 80) || "paper";
    const disp = `attachment; filename="${safeName}.pdf"`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disp,
        "Content-Length": String(body.length),
      },
    });
  } catch (e) {
    console.error("[download-pdf]", e);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
