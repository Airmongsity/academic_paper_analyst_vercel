"use client";

import React, { useState } from "react";

type Paper = {
  title: string;
  link: string;
  snippet: string;
  publicationInfo: string;
  pdfUrl: string;
  source?: "scholar" | "ncpssd";
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [keywordInput, setKeywordInput] = useState("");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [source, setSource] = useState<"all" | "scholar" | "ncpssd">("all");
  const [error, setError] = useState<string | null>(null);
  const [downloadingLink, setDownloadingLink] = useState<string | null>(null);
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<string | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<{
    totalChunks: number;
    papers: { title: string; chunks: string[] }[];
    failed: number;
  } | null>(null);
  const [uploadedPdfs, setUploadedPdfs] = useState<{ name: string; file: File }[]>([]);

  const hasCorpus = selectedLinks.size > 0 || uploadedPdfs.length > 0;

  // 分析语料库：流式进度，下载 PDF、解析、切分
  const handleAnalyze = async () => {
    const selected = papers.filter((p) => selectedLinks.has(p.link));
    if (!hasCorpus) return;

    setAnalyzing(true);
    setAnalyzeProgress(null);
    setAnalyzeResult(null);
    setError(null);

    const uploadedBase64 = await Promise.all(
      uploadedPdfs.map(async (u) => ({
        name: u.name,
        base64: await new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => {
            const dataUrl = r.result as string;
            resolve(dataUrl.split(",")[1] ?? "");
          };
          r.readAsDataURL(u.file);
        }),
      }))
    );

    try {
      const res = await fetch("/api/analyze-corpus-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          papers: selected.map((p) => ({ link: p.link, source: p.source, pdfUrl: p.pdfUrl, title: p.title })),
          uploadedPdfs: uploadedBase64,
        }),
      });
      if (!res.ok || !res.body) throw new Error("请求失败");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.type === "progress") setAnalyzeProgress(data.msg);
            else if (data.type === "result") {
              setAnalyzeResult({ totalChunks: data.totalChunks, papers: data.papers ?? [], failed: data.failed ?? 0 });
              setAnalyzeProgress(null);
            } else if (data.type === "error") throw new Error(data.error);
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress(null);
    }
  };

  // NCPSSD：后端代理下载 PDF（Playwright 抓取，绕过 403）
  const handleNcpssdPdfDownload = async (articleUrl: string, title: string) => {
    setDownloadingLink(articleUrl);
    try {
      const res = await fetch("/api/download-ncpssd-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: articleUrl }),
      });
      if (!res.ok) throw new Error("下载失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.slice(0, 30).replace(/[/\\?*:|"]/g, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("PDF 下载失败，请稍后重试");
    } finally {
      setDownloadingLink(null);
    }
  };

  // 根据关键词自动搜索论文
  const searchPapers = async (kw: string) => {
    const trimmed = kw.trim();
    if (!trimmed) return;

    setSearching(true);
    setError(null);
    setPapers([]);
    setSelectedLinks(new Set());

    try {
      const response = await fetch("/api/search-papers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ keywords: trimmed, source }),
      });

      if (!response.ok) {
        throw new Error((await response.text()) || "Failed to search papers");
      }

      const data = await response.json();
      const list = (data.papers || []) as Paper[];
      setPapers(list);
    } catch (error: unknown) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("An unknown error occurred when searching papers");
      }
    } finally {
      setSearching(false);
      setHasSearched(true);
    }
  };

  // 上传 PDF，获取关键词，然后自动搜索论文
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setError("Please select a file");
      return;
    }

    setLoading(true);
    setError(null);
    setKeywordInput("");
    setPapers([]);
    setHasSearched(false);
    setSelectedLinks(new Set());

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error((await response.text()) || "Failed to upload file");
      }

      const data = await response.json();
      const kws: string = data.keywords || "";
      setKeywordInput(kws);

      // 自动根据关键词搜索论文（无需用户再点按钮）
      if (kws.trim()) {
        await searchPapers(kws);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("An unknown error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (link: string) => {
    setSelectedLinks((prev) => {
      const next = new Set(prev);
      if (next.has(link)) next.delete(link);
      else next.add(link);
      return next;
    });
  };

  const hasPapers = papers.length > 0;

  return (
    <main className="min-h-screen p-4 md:p-6 transition-all duration-500 ease-out">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">Better Paper Docs</h1>
          <p className="text-sm text-gray-500 mt-1">
            上传 PDF 自动提取关键词并搜索类似论文，选择语料后交由 AI 修改原文。
          </p>
        </header>

        <div
          className={`grid gap-6 transition-all duration-500 ease-out ${
            "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
          }`}
        >
          {/* 左侧：上传 / 检索 / 论文列表 */}
          <div
            className={`flex flex-col gap-4 transition-all duration-500 ${
              hasPapers ? "opacity-100 translate-x-0" : "opacity-100"
            }`}
          >
            <div className={`${hasPapers ? "flex flex-wrap items-end gap-3" : "space-y-4"} border-b pb-4`}>
              <form onSubmit={handleSubmit} className={`flex flex-wrap items-end gap-2 ${hasPapers ? "flex-1 min-w-[200px]" : "w-full"}`}>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="p-2 border border-gray-300 rounded-md text-sm flex-1 min-w-[140px]"
                />
                <button
                  type="submit"
                  disabled={loading || !file}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {loading ? "处理中..." : "上传 PDF"}
                </button>
              </form>
              <div className={`flex flex-wrap gap-2 ${hasPapers ? "flex-1 min-w-[220px]" : "w-full"}`}>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as "all" | "scholar" | "ncpssd")}
                  className="p-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="all">All (Scholar + NCPSSD)</option>
                  <option value="scholar">Google Scholar</option>
                  <option value="ncpssd">NCPSSD</option>
                </select>
                <input
                  type="text"
                  value={keywordInput}
                  onChange={(e) => {
                    setKeywordInput(e.target.value);
                    setHasSearched(false);
                  }}
                  placeholder="关键词"
                  className="flex-1 min-w-[100px] p-2 border border-gray-300 rounded-md text-sm"
                />
                <button
                  type="button"
                  onClick={() => searchPapers(keywordInput)}
                  disabled={searching || !keywordInput.trim()}
                  className="px-4 py-2 bg-indigo-500 text-white text-sm rounded-md hover:bg-indigo-600 disabled:opacity-50 whitespace-nowrap"
                >
                  {searching ? "检索中..." : "搜索"}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            {searching && <p className="text-sm text-gray-500">正在检索论文…</p>}
            {!searching && hasSearched && papers.length === 0 && (
              <p className="text-sm text-amber-600">未找到相关论文，可修改关键词后重试。</p>
            )}

            {hasPapers && (
              <div className="animate-fade-slide-left">
                <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                  Similar Papers
                  <span className="text-xs font-normal text-gray-500">点击卡片加入语料库</span>
                </h2>
                <ul className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                  {papers.map((paper, index) => (
                    <li
                      key={paper.link || `paper-${index}`}
                      onClick={() => toggleSelect(paper.link)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && toggleSelect(paper.link)}
                      className={`border rounded-md p-3 transition-colors cursor-pointer select-none hover:bg-gray-50 ${
                        selectedLinks.has(paper.link) ? "border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-200" : ""
                      }`}
                    >
                      <div className="flex gap-2">
                        <div className="shrink-0 mt-0.5 w-5 h-5 rounded border flex items-center justify-center">
                          {selectedLinks.has(paper.link) && (
                            <span className="text-indigo-600 text-xs">✓</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {paper.source && (
                            <span className="text-xs text-gray-400 mr-2">
                              {paper.source === "ncpssd" ? "NCPSSD" : "Scholar"}
                            </span>
                          )}
                          <a
                            href={paper.link}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-semibold text-blue-600 hover:underline inline-block w-fit"
                          >
                            {paper.title}
                          </a>
                          {paper.publicationInfo && (
                            <p className="mt-1 text-xs text-gray-500">{paper.publicationInfo}</p>
                          )}
                          {paper.snippet && (
                            <p className="mt-1 text-xs text-gray-700 line-clamp-2">{paper.snippet}</p>
                          )}
                          {paper.source === "ncpssd" && paper.link ? (
                            <button
                              type="button"
                              data-article-url={paper.link}
                              data-title={paper.title}
                              onClick={(e) => {
                                e.stopPropagation();
                                const url = e.currentTarget.getAttribute("data-article-url");
                                const title = e.currentTarget.getAttribute("data-title");
                                if (url) handleNcpssdPdfDownload(url, title ?? "paper");
                              }}
                              disabled={downloadingLink === paper.link}
                              className="mt-1 text-xs text-blue-500 hover:underline disabled:opacity-50"
                            >
                              {downloadingLink === paper.link ? "下载中…" : "PDF 下载"}
                            </button>
                          ) : paper.pdfUrl ? (
                            <a
                              href={paper.pdfUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="mt-1 text-xs text-blue-500 hover:underline"
                            >
                              PDF 下载
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 右侧：解析内容 */}
          {(
            <div
              className="animate-fade-slide-right border border-dashed border-gray-300 rounded-lg p-6 min-h-[400px] bg-gray-50/50 flex flex-col gap-4"
            >
              <p className="text-gray-500">
                已选 <strong className="text-indigo-600">{selectedLinks.size}</strong> 篇论文
                {uploadedPdfs.length > 0 && (
                  <>，上传 <strong className="text-indigo-600">{uploadedPdfs.length}</strong> 个 PDF</>
                )}
              </p>

              <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-500">上传 PDF 加入语料库</label>
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setUploadedPdfs((prev) => [...prev, ...files.map((f) => ({ name: f.name, file: f }))]);
                    e.target.value = "";
                  }}
                  className="text-sm"
                />
                {uploadedPdfs.length > 0 && (
                  <ul className="text-xs text-gray-500 space-y-1">
                    {uploadedPdfs.map((u, i) => (
                      <li key={i} className="flex items-center gap-2">
                        {u.name}
                        <button
                          type="button"
                          onClick={() => setUploadedPdfs((p) => p.filter((_, j) => j !== i))}
                          className="text-red-500 hover:underline"
                        >
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                type="button"
                onClick={handleAnalyze}
                disabled={!hasCorpus || analyzing}
                className="self-center px-6 py-2.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {analyzing ? "分析中…" : "分析"}
              </button>
              {analyzeProgress && (
                <p className="text-sm text-indigo-600 animate-pulse">{analyzeProgress}</p>
              )}
              {analyzeResult && (
                <div className="text-left text-sm space-y-3 flex-1 min-w-0">
                  <p className="text-gray-600 shrink-0">
                    成功 {analyzeResult.papers.length} 篇，共 {analyzeResult.totalChunks} 个 chunks
                    {analyzeResult.failed > 0 && (
                      <span className="text-amber-600">，{analyzeResult.failed} 篇获取失败</span>
                    )}
                  </p>
                  <div className="space-y-3 pr-2">
                    {analyzeResult.papers.map((p, i) => (
                      <details key={i} className="border rounded p-2 bg-white">
                        <summary className="cursor-pointer font-medium w-fit">{p.title}</summary>
                        <p className="text-gray-500 mt-1 text-xs">共 {p.chunks.length} 个 chunks</p>
                        <ol className="mt-2 space-y-1.5 list-decimal list-inside text-xs text-gray-700 whitespace-pre-wrap break-words">
                          {p.chunks.map((chunk, j) => (
                            <li key={j} className="pl-1 border-l-2 border-gray-200">
                              {chunk}
                            </li>
                          ))}
                        </ol>
                      </details>
                    ))}
                  </div>
                </div>
              )}
              {!analyzeResult && (
                <p className="text-sm text-gray-400 max-w-xs self-center text-center">
                  {hasCorpus
                    ? "将下载并解析所选 PDF，清洗页眉页脚、合并断行，切分后供后续向量化与 AI 使用。"
                    : "上传 PDF 加入语料库，或先搜索论文并勾选。"}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
