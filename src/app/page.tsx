"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { isChunkLinguistic } from "@/lib/pdf-utils";

/** 自适应内容高度的 textarea，避免与父级滚动冲突 */
function AutoHeightTextarea({
  value,
  onChange,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const max = 280;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.min(Math.max(el.scrollHeight, 40), max);
    el.style.height = `${h}px`;
    el.style.overflowY = h >= max ? "auto" : "hidden";
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      className={className}
      style={{ minHeight: "2.5rem", maxHeight: `${max}px` }}
      {...props}
    />
  );
}

type Paper = {
  title: string;
  link: string;
  snippet: string;
  publicationInfo: string;
  pdfUrl: string;
  source?: "scholar" | "ncpssd";
  requiresLogin?: boolean;
};

type Step = "upload" | "search" | "parse" | "optimize";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "上传论文" },
  { id: "search", label: "查找类似论文" },
  { id: "parse", label: "解析语料库" },
  { id: "optimize", label: "优化当前论文" },
];

export default function Home() {
  const [activeStep, setActiveStep] = useState<Step>("upload");
  const [completedSteps, setCompletedSteps] = useState<Set<Step>>(new Set());

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [parsedText, setParsedText] = useState("");
  const [confirmedText, setConfirmedText] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [source, setSource] = useState<"all" | "scholar" | "ncpssd">("all");
  const [error, setError] = useState<string | null>(null);
  const [downloadingLink, setDownloadingLink] = useState<string | null>(null);
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());
  const [uploadedPdfs, setUploadedPdfs] = useState<{ name: string; file: File }[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<string | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<{
    totalChunks: number;
    papers: { title: string; chunks: string[] }[];
    failed: number;
    skipped?: number;
    successCount?: number;
    totalCount?: number;
  } | null>(null);
  const [corpusMaxChunk, setCorpusMaxChunk] = useState(800);
  const [corpusMinChunk, setCorpusMinChunk] = useState(280);
  const [selectedChunks, setSelectedChunks] = useState<Set<string>>(new Set());
  const [vectorizing, setVectorizing] = useState(false);
  const [vectorizeMsg, setVectorizeMsg] = useState<string | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [splitChunks, setSplitChunks] = useState<string[]>([]);
  const [splitChunksSelected, setSplitChunksSelected] = useState<Set<number>>(new Set());
  const [splitMaxChunk, setSplitMaxChunk] = useState(800);
  const [splitMinChunk, setSplitMinChunk] = useState(280);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState<string | null>(null);
  const [optimizedResult, setOptimizedResult] = useState<
    { original: string; similar: { content: string; similarity: number; title?: string }[]; optimized: string }[]
  >([]);
  const [optimizedDocxBase64, setOptimizedDocxBase64] = useState<string | null>(null);

  const hasCorpus = selectedLinks.size > 0 || uploadedPdfs.length > 0;
  const textToOptimize = confirmedText || parsedText;
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [chunkAiResults, setChunkAiResults] = useState<Map<string, { valid: boolean; reason?: string }>>(new Map());

  useEffect(() => {
    if (!analyzeResult) return;
    setAnalyzeResult(null);
    setSelectedChunks(new Set());
    setChunkAiResults(new Map());
    setCompletedSteps((p) => {
      const n = new Set(p);
      n.delete("parse");
      return n;
    });
    // 语料变化时清空解析结果，避免使用过期数据
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLinks, uploadedPdfs]);

  const markCompleted = useCallback((step: Step) => {
    setCompletedSteps((prev) => new Set(prev).add(step));
  }, []);

  const goNext = useCallback((current: Step) => {
    const idx = STEPS.findIndex((s) => s.id === current);
    if (idx >= 0 && idx < STEPS.length - 1) setActiveStep(STEPS[idx + 1].id);
  }, []);

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

  const searchPapers = async (kw: string) => {
    const trimmed = kw.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    setPapers([]);
    setSelectedLinks(new Set());
    try {
      const res = await fetch("/api/search-papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: trimmed, source }),
      });
      if (!res.ok) throw new Error((await res.text()) || "搜索失败");
      const data = await res.json();
      const list = (data.papers || []) as Paper[];
      setPapers(list);
      // 默认勾选前 3 篇可下载 PDF 的论文：NCPSSD 或有 pdfUrl 且无需登录的 Scholar
      const available = list.filter(
        (p) => p.source === "ncpssd" && p.link || (p.pdfUrl && !p.requiresLogin)
      );
      setSelectedLinks(new Set(available.slice(0, 3).map((p) => p.link)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜索失败");
    } finally {
      setSearching(false);
      setHasSearched(true);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError(null);
    setParsedText("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = (await res.json().catch(() => ({}))) as { text?: string; keywords?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "上传失败");
      setParsedText(data.text || "");
      setKeywordInput(data.keywords || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmParsed = () => {
    setConfirmedText(parsedText);
    markCompleted("upload");
    goNext("upload");
    if (keywordInput.trim()) searchPapers(keywordInput);
  };

  const handleAnalyze = async () => {
    if (!hasCorpus) return;
    const selected = papers.filter((p) => selectedLinks.has(p.link));
    setAnalyzing(true);
    setAnalyzeProgress(null);
    setAnalyzeResult(null);
    setSelectedChunks(new Set());
    setError(null);
    const uploadedBase64 = await Promise.all(
      uploadedPdfs.map(async (u) => ({
        name: u.name,
        base64: await new Promise<string>((r) => {
          const reader = new FileReader();
          reader.onload = () => r((reader.result as string).split(",")[1] ?? "");
          reader.readAsDataURL(u.file);
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
          maxChunkSize: corpusMaxChunk,
          minChunkSize: corpusMinChunk,
        }),
      });
      if (!res.ok || !res.body) throw new Error("请求失败");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let lastResult: { papers: { title?: string; chunks: string[] }[] } | null = null;
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
              const list = data.papers ?? [];
              lastResult = { papers: list };
              setAnalyzeResult({
                totalChunks: data.totalChunks,
                papers: list,
                failed: data.failed ?? 0,
                skipped: data.skipped,
                successCount: data.successCount,
                totalCount: data.totalCount,
              });
              setAnalyzeProgress(null);
            } else if (data.type === "error") throw new Error(data.error);
          } catch (err) {
            if (!(err instanceof SyntaxError)) throw err;
          }
        }
      }
      if (lastResult && lastResult.papers.length > 0) {
        const items: { paperIndex: number; chunkIndex: number; content: string; title?: string }[] = [];
        lastResult.papers.forEach((p, i) => {
          p.chunks.forEach((content: string, j: number) => {
            items.push({ paperIndex: i, chunkIndex: j, content, title: p.title });
          });
        });
        if (items.length > 0) {
          setAnalyzingAi(true);
          const BATCH = 20;
          const allResults = new Map<string, { valid: boolean; reason?: string }>();
          const initial = new Set<string>();
          try {
            for (let i = 0; i < items.length; i += BATCH) {
              const batch = items.slice(i, i + BATCH);
              const aiRes = await fetch("/api/analyze-corpus-ai", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: batch }),
              });
              const aiData = await aiRes.json();
              const aiList = (aiData.results ?? []) as { paperIndex: number; chunkIndex: number; valid: boolean; reason?: string }[];
              aiList.forEach((r) => {
                const k = `${r.paperIndex}-${r.chunkIndex}`;
                allResults.set(k, { valid: r.valid, reason: r.reason });
                if (r.valid) initial.add(k);
              });
              setChunkAiResults(new Map(allResults));
              setSelectedChunks(new Set(initial));
            }
          } catch {
            lastResult.papers.forEach((p, i) => {
              p.chunks.forEach((chunk: string, j: number) => {
                if (isChunkLinguistic(chunk)) initial.add(`${i}-${j}`);
              });
            });
            setSelectedChunks(initial);
          } finally {
            setAnalyzingAi(false);
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

  useEffect(() => {
    if (activeStep === "parse" && hasCorpus && !analyzing && !analyzeResult) {
      handleAnalyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, hasCorpus, analyzing, analyzeResult]);

  const toggleSelect = (link: string) => {
    setSelectedLinks((prev) => {
      const next = new Set(prev);
      if (next.has(link)) next.delete(link);
      else next.add(link);
      return next;
    });
  };

  const chunkKey = (i: number, j: number) => `${i}-${j}`;
  const toggleChunk = (i: number, j: number) => {
    setSelectedChunks((prev) => {
      const next = new Set(prev);
      const k = chunkKey(i, j);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const selectAllChunks = useCallback(() => {
    if (!analyzeResult) return;
    const all = new Set<string>();
    analyzeResult.papers.forEach((p, i) => p.chunks.forEach((_, j) => all.add(chunkKey(i, j))));
    setSelectedChunks(all);
  }, [analyzeResult]);
  const deselectAllChunks = useCallback(() => setSelectedChunks(new Set()), []);

  const handleVectorize = async () => {
    if (!analyzeResult || selectedChunks.size === 0) return;
    setVectorizing(true);
    setVectorizeMsg(null);
    setError(null);
    try {
      const chunksToSend: { content: string; metadata: Record<string, unknown> }[] = [];
      analyzeResult.papers.forEach((p, i) => {
        p.chunks.forEach((chunk, j) => {
          if (selectedChunks.has(chunkKey(i, j))) chunksToSend.push({ content: chunk, metadata: { title: p.title } });
        });
      });
      const res = await fetch("/api/vectorize-chunks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunks: chunksToSend }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "向量化失败");
      const skipped = data.skipped ?? 0;
      setVectorizeMsg(
        skipped > 0
          ? `成功存入 ${data.inserted} 条，跳过 ${skipped} 条已存在`
          : `成功存入 ${data.inserted} 条向量`
      );
      markCompleted("parse");
      goNext("parse");
    } catch (e) {
      setError(e instanceof Error ? e.message : "向量化失败");
    } finally {
      setVectorizing(false);
    }
  };

  const handleSplit = async () => {
    const text = textToOptimize.trim();
    if (!text) return;
    setSplitting(true);
    setError(null);
    setSplitChunks([]);
    setOptimizedResult([]);
    setOptimizedDocxBase64(null);
    try {
      const res = await fetch("/api/split-paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, maxChunkSize: splitMaxChunk, minChunkSize: splitMinChunk }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "切分失败");
      const chunks = data.chunks ?? [];
      setSplitChunks(chunks);
      setSplitChunksSelected(new Set(chunks.map((_: unknown, i: number) => i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "切分失败");
    } finally {
      setSplitting(false);
    }
  };

  const toggleSplitChunk = (i: number) => {
    setSplitChunksSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const updateSplitChunk = (i: number, value: string) => {
    setSplitChunks((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  };

  const handleOptimize = async () => {
    if (splitChunks.length === 0) return;
    setOptimizing(true);
    setOptimizeProgress(null);
    setError(null);
    setOptimizedResult([]);
    setOptimizedDocxBase64(null);
    const optimizeMask = splitChunks.map((_, i) => splitChunksSelected.has(i));
    try {
      const res = await fetch("/api/optimize-paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunks: splitChunks, optimizeMask }),
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
            if (data.type === "progress") setOptimizeProgress(data.msg ?? "");
            else if (data.type === "chunk") setOptimizedResult((prev) => [...prev, data.data]);
            else if (data.type === "result") {
              setOptimizedResult(data.chunks ?? []);
              setOptimizedDocxBase64(data.docxBase64 ?? null);
              if (data.docxBase64) {
                const blob = new Blob(
                  [Uint8Array.from(atob(data.docxBase64), (c) => c.charCodeAt(0))],
                  {
                    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  }
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "optimized-paper.docx";
                a.click();
                URL.revokeObjectURL(url);
              }
              setOptimizeProgress(null);
              markCompleted("optimize");
            } else if (data.type === "error") throw new Error(data.error);
          } catch (err) {
            if (!(err instanceof SyntaxError)) throw err;
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "优化失败");
    } finally {
      setOptimizing(false);
      setOptimizeProgress(null);
    }
  };

  return (
    <main className="min-h-screen flex">
      {/* 左侧栏 */}
      <aside className="w-52 shrink-0 border-r border-gray-200 bg-gray-50/50 flex flex-col p-4">
        <h1 className="text-lg font-bold mb-4">Better Paper Docs</h1>
        <nav className="flex flex-col gap-1">
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveStep(s.id)}
              className={`text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                activeStep === s.id
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {completedSteps.has(s.id) && (
                <span className="text-indigo-500 text-xs">✓</span>
              )}
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* 主内容 */}
      <div className="flex-1 min-w-0 p-6 overflow-auto">
        {error && (
          <p className="text-sm text-red-500 mb-4">{error}</p>
        )}

        {activeStep === "upload" && (
          <div className="w-full max-w-full space-y-4">
            <h2 className="text-xl font-bold">上传论文</h2>
            <p className="text-sm text-gray-500">上传待优化的 PDF 或 Word (.docx)，解析后请确认内容再继续。</p>
            {!parsedText ? (
              <form onSubmit={handleUploadSubmit} className="flex flex-col gap-3">
                <div
                  className="p-6 border-2 border-dashed border-gray-300 rounded-lg text-center transition-colors hover:border-indigo-400 cursor-pointer"
                  onClick={() => document.getElementById("file-upload-input")?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && document.getElementById("file-upload-input")?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add("ring-2", "ring-indigo-300", "border-indigo-400"); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove("ring-2", "ring-indigo-300", "border-indigo-400"); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.classList.remove("ring-2", "ring-indigo-300", "border-indigo-400");
                    const items = e.dataTransfer?.files;
                    if (!items?.length) return;
                    const f = Array.from(items).find((x) => /\.(pdf|docx)$/i.test(x.name));
                    if (f) setFile(f);
                  }}
                >
                  <input
                    id="file-upload-input"
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  <p className="text-sm text-gray-600">
                    {file ? file.name : "点击或拖拽 PDF / Word (.docx) 到此处"}
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={loading || !file}
                  className="px-4 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600 disabled:opacity-50 w-fit"
                >
                  {loading ? "解析中…" : "上传并解析"}
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm font-medium">解析结果，请检查并确认：</label>
                <textarea
                  value={parsedText}
                  onChange={(e) => setParsedText(e.target.value)}
                  className="w-full min-h-[60vh] max-h-[75vh] p-4 border rounded-lg text-base leading-relaxed resize-y overflow-y-auto"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmParsed}
                    className="px-4 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600"
                  >
                    确认并继续
                  </button>
                  <button
                    type="button"
                    onClick={() => setParsedText("")}
                    className="px-4 py-2 border rounded-md hover:bg-gray-50"
                  >
                    重新上传
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeStep === "search" && (
          <div className="w-full max-w-full space-y-4">
            <h2 className="text-xl font-bold">查找类似论文</h2>
            <p className="text-sm text-gray-500">根据关键词搜索，选择论文加入语料库。</p>
            <div className="flex flex-wrap gap-2 items-end">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as "all" | "scholar" | "ncpssd")}
                className="p-2 border rounded-md text-sm"
              >
                <option value="all">All (Scholar + NCPSSD)</option>
                <option value="scholar">Google Scholar</option>
                <option value="ncpssd">NCPSSD</option>
              </select>
              <input
                type="text"
                value={keywordInput}
                onChange={(e) => { setKeywordInput(e.target.value); setHasSearched(false); }}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), keywordInput.trim() && searchPapers(keywordInput.trim()))}
                placeholder="关键词"
                className="flex-1 min-w-[160px] p-2 border rounded-md text-sm"
              />
              <button
                type="button"
                onClick={() => searchPapers(keywordInput)}
                disabled={searching || !keywordInput.trim()}
                className="px-4 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600 disabled:opacity-50"
              >
                {searching ? "检索中…" : "搜索"}
              </button>
            </div>
            {hasSearched && papers.length === 0 && (
              <p className="text-sm text-amber-600">未找到相关论文，可修改关键词后重试。</p>
            )}
            {papers.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-gray-600">已选 {selectedLinks.size} 篇，点击卡片加入语料库</p>
                <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
                  {[...papers]
                    .sort((a, b) => {
                      const aScore = a.source === "ncpssd" ? 2 : a.pdfUrl ? (a.requiresLogin ? 1 : 2) : 0;
                      const bScore = b.source === "ncpssd" ? 2 : b.pdfUrl ? (b.requiresLogin ? 1 : 2) : 0;
                      return bScore - aScore;
                    })
                    .map((p, i) => (
                    <li
                      key={p.link || i}
                      onClick={() => toggleSelect(p.link)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && toggleSelect(p.link)}
                      className={`border rounded p-3 cursor-pointer hover:bg-gray-50 ${
                        selectedLinks.has(p.link) ? "border-indigo-500 bg-indigo-50/50" : ""
                      }`}
                    >
                      <div className="flex gap-2">
                        <span className="shrink-0 w-5 h-5 rounded border flex items-center justify-center text-xs">
                          {selectedLinks.has(p.link) && "✓"}
                        </span>
                        <div className="min-w-0">
                          <a href={p.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                            className="text-sm font-semibold text-blue-600 hover:underline">
                            {p.title}
                          </a>
                          {p.snippet && <p className="mt-1 text-xs text-gray-600 line-clamp-2">{p.snippet}</p>}
                          {p.source === "ncpssd" && p.link && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleNcpssdPdfDownload(p.link, p.title); }}
                              disabled={downloadingLink === p.link} className="mt-1 text-xs text-blue-500 hover:underline">
                              {downloadingLink === p.link ? "下载中…" : "PDF 下载"}
                            </button>
                          )}
                          {p.source === "scholar" && p.pdfUrl && (
                            <>
                              <a href={p.pdfUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                                className="mt-1 text-xs text-blue-500 hover:underline inline-block mr-2">
                                预览 PDF
                              </a>
                              {p.requiresLogin ? (
                                <span className="mt-1 text-xs text-amber-600" title="academia.edu 等需登录">🔐 需要登录</span>
                              ) : (
                                <a
                                  href={`/api/download-pdf?url=${encodeURIComponent(p.pdfUrl)}&filename=${encodeURIComponent(p.title.slice(0, 50))}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-1 text-xs text-emerald-600 hover:underline inline-block"
                                >
                                  PDF 下载
                                </a>
                              )}
                            </>
                          )}
                          {p.source === "scholar" && !p.pdfUrl?.trim() && (
                            <span className="mt-1 text-xs text-gray-400">无法自动下载</span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => { markCompleted("search"); goNext("search"); }}
                  disabled={selectedLinks.size === 0 && uploadedPdfs.length === 0}
                  className="px-4 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600 disabled:opacity-50"
                >
                  已选 {selectedLinks.size} 篇，继续
                </button>
              </div>
            )}
            <div className="border-t pt-4 mt-4">
              <label className="block text-sm font-medium mb-2">或上传 PDF 加入语料库（支持拖拽）</label>
              <div
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-indigo-400", "bg-indigo-50/50"); }}
                onDragLeave={(e) => { e.currentTarget.classList.remove("border-indigo-400", "bg-indigo-50/50"); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove("border-indigo-400", "bg-indigo-50/50");
                  const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type === "application/pdf");
                  if (files.length) setUploadedPdfs((prev) => [...prev, ...files.map((f) => ({ name: f.name, file: f }))]);
                }}
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center text-sm text-gray-500 hover:border-gray-400 transition-colors cursor-pointer"
                onClick={() => document.getElementById("pdf-upload-input")?.click()}
              >
                <input
                  id="pdf-upload-input"
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setUploadedPdfs((prev) => [...prev, ...files.map((f) => ({ name: f.name, file: f }))]);
                    e.target.value = "";
                  }}
                />
                拖动 PDF 到此处，或点击选择文件
              </div>
              {uploadedPdfs.length > 0 && (
                <ul className="text-xs text-gray-500 mt-1 space-y-1">
                  {uploadedPdfs.map((u, i) => (
                    <li key={i} className="flex gap-2">
                      {u.name}
                      <button type="button" onClick={() => setUploadedPdfs((p) => p.filter((_, j) => j !== i))}
                        className="text-red-500 hover:underline">移除</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {activeStep === "parse" && (
          <div className="w-full max-w-full space-y-4">
            <h2 className="text-xl font-bold">解析语料库</h2>
            <p className="text-sm text-gray-500">下载并解析所选论文 PDF，切分语料块，向量化存储完成后进入下一步。</p>
            <p className="text-sm">已选论文 {selectedLinks.size} 篇，上传 PDF {uploadedPdfs.length} 个</p>
            <div className="flex flex-wrap gap-4 items-center">
              <label className="flex items-center gap-2 text-sm">
                最大切分字符：
                <input
                  type="number"
                  min={200}
                  max={2000}
                  value={corpusMaxChunk}
                  onChange={(e) => setCorpusMaxChunk(Number(e.target.value) || 800)}
                  className="w-20 px-2 py-1 border rounded"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                最小连续字符：
                <input
                  type="number"
                  min={50}
                  max={500}
                  value={corpusMinChunk}
                  onChange={(e) => setCorpusMinChunk(Number(e.target.value) || 280)}
                  className="w-20 px-2 py-1 border rounded"
                />
              </label>
            </div>
            {!analyzeResult && (
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={!hasCorpus || analyzing}
                className="px-6 py-2.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50"
              >
                {analyzing ? "解析中…" : "手动解析"}
              </button>
            )}
            {analyzeResult && (
              <button
                type="button"
                onClick={() => { setAnalyzeResult(null); setChunkAiResults(new Map()); handleAnalyze(); }}
                disabled={analyzing}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm"
              >
                重新解析
              </button>
            )}
            {(analyzeProgress || analyzingAi) && (
              <p className="text-sm text-indigo-600 animate-pulse">
                {analyzingAi ? "AI 语料分析中…" : analyzeProgress}
              </p>
            )}
            {analyzeResult && (
              <div className="space-y-3">
                <p className="text-sm">
                  成功 {analyzeResult.papers.length} 篇，共 {analyzeResult.totalChunks} 个 chunks
                  {(analyzeResult.failed > 0 || (analyzeResult.skipped ?? 0) > 0) && (
                    <span className="text-amber-600 ml-1">
                      （解析了 {analyzeResult.successCount ?? analyzeResult.papers.length}/{analyzeResult.totalCount ?? analyzeResult.papers.length + analyzeResult.failed} 份 PDF
                      {(analyzeResult.skipped ?? 0) > 0 ? `，${analyzeResult.skipped} 篇已解析跳过` : ""}
                      ）
                    </span>
                  )}
                </p>
                <p className="text-xs text-indigo-600">已选 {selectedChunks.size} 个语料块（AI 推荐已预选）</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <button type="button" onClick={selectAllChunks} className="text-xs px-2 py-1 border rounded hover:bg-gray-100">全选</button>
                  <button type="button" onClick={deselectAllChunks} className="text-xs px-2 py-1 border rounded hover:bg-gray-100">全部不选</button>
                  <button
                    type="button"
                    onClick={handleVectorize}
                    disabled={vectorizing || selectedChunks.size === 0}
                    className="px-6 py-2.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {vectorizing ? "向量化中…" : "向量化并存储"}
                  </button>
                  {vectorizeMsg && <span className="text-xs text-emerald-600">{vectorizeMsg}</span>}
                </div>
                <div className="min-h-[75vh] max-h-[85vh] overflow-y-auto">
                  <div className="grid grid-cols-2 gap-3">
                    {analyzeResult.papers.flatMap((p, i) =>
                      p.chunks.map((chunk, j) => {
                        const key = chunkKey(i, j);
                        const checked = selectedChunks.has(key);
                        const ai = chunkAiResults.get(key);
                        const hasAi = ai !== undefined;
                        const isValid = ai?.valid ?? true;
                        const reason = ai?.reason;
                        return (
                          <div
                            key={key}
                            className={`border rounded-lg p-3 flex flex-col min-h-[140px] bg-white hover:bg-gray-50/80 cursor-pointer ${
                              checked ? "ring-2 ring-indigo-400 bg-indigo-50/30" : ""
                            }`}
                            onClick={() => toggleChunk(i, j)}
                          >
                            <p className="text-sm leading-relaxed text-gray-800 flex-1 whitespace-pre-wrap">
                              {chunk}
                            </p>
                            {p.title && <span className="text-xs text-gray-400 mt-1 shrink-0">{p.title}</span>}
                            <div className="mt-2 flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleChunk(i, j)}
                                  className="shrink-0"
                                />
                                <span className="text-xs text-gray-500">保存</span>
                              </label>
                              {hasAi ? (
                                <span className={`text-xs ${isValid ? "text-emerald-600" : "text-amber-600"}`}>
                                  {isValid ? "✓ 有效" : `✗ ${reason ?? "无效"}`}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-300">分析中…</span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeStep === "optimize" && (
          <div className="w-full max-w-full space-y-4">
            <h2 className="text-xl font-bold">优化当前论文</h2>
            <p className="text-sm text-gray-500">
              先切分段落，选择需优化的块并可编辑，再基于语料库检索优化。左右对照便于比较与复制。
            </p>
            {textToOptimize ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">已加载待优化论文（{textToOptimize.length} 字）</p>

                {splitChunks.length === 0 ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-4 items-center">
                      <label className="flex items-center gap-2 text-sm">
                        最大切分字符：
                        <input
                          type="number"
                          min={200}
                          max={2000}
                          value={splitMaxChunk}
                          onChange={(e) => setSplitMaxChunk(Number(e.target.value) || 800)}
                          className="w-20 px-2 py-1 border rounded"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        最小连续字符：
                        <input
                          type="number"
                          min={50}
                          max={500}
                          value={splitMinChunk}
                          onChange={(e) => setSplitMinChunk(Number(e.target.value) || 280)}
                          className="w-20 px-2 py-1 border rounded"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={handleSplit}
                      disabled={splitting}
                      className="px-6 py-2.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50"
                    >
                      {splitting ? "切分中…" : "切分并预览"}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-4 items-center">
                      <label className="flex items-center gap-2 text-sm">
                        最大切分：
                        <input
                          type="number"
                          min={200}
                          max={2000}
                          value={splitMaxChunk}
                          onChange={(e) => setSplitMaxChunk(Number(e.target.value) || 800)}
                          className="w-20 px-2 py-1 border rounded"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        最小连续：
                        <input
                          type="number"
                          min={50}
                          max={500}
                          value={splitMinChunk}
                          onChange={(e) => setSplitMinChunk(Number(e.target.value) || 280)}
                          className="w-20 px-2 py-1 border rounded"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={handleOptimize}
                        disabled={optimizing}
                        className="px-6 py-2.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50"
                      >
                        {optimizing ? "优化中…" : splitChunksSelected.size > 0 ? `优化选中的 ${splitChunksSelected.size} 段（未选段将保留原文）` : "生成完整文档（全部保留原文）"}
                      </button>
                      <button
                        type="button"
                        onClick={handleSplit}
                        disabled={splitting}
                        className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                      >
                        重新切分
                      </button>
                    </div>
                    {optimizeProgress && (
                      <p className="text-sm text-indigo-600 animate-pulse font-medium">{optimizeProgress}</p>
                    )}

                    {optimizedResult.length === 0 ? (
                      <div className="min-h-[200px] max-h-[60vh] overflow-y-auto space-y-2">
                        <div className="flex gap-2 items-center">
                          <p className="text-xs text-gray-500">勾选需优化的段落，可编辑后再优化</p>
                          <button
                            type="button"
                            onClick={() => setSplitChunksSelected(new Set(splitChunks.map((_, i) => i)))}
                            className="text-xs px-2 py-1 border rounded hover:bg-gray-100"
                          >
                            全选
                          </button>
                          <button
                            type="button"
                            onClick={() => setSplitChunksSelected(new Set())}
                            className="text-xs px-2 py-1 border rounded hover:bg-gray-100"
                          >
                            全部不选
                          </button>
                        </div>
                        {splitChunks.map((chunk, i) => (
                          <div
                            key={i}
                            className={`border rounded-lg p-3 flex gap-3 ${
                              splitChunksSelected.has(i) ? "border-indigo-500 bg-indigo-50/30" : "bg-gray-50/50"
                            }`}
                          >
                            <label className="shrink-0 flex items-start gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={splitChunksSelected.has(i)}
                                onChange={() => toggleSplitChunk(i)}
                                className="mt-1"
                              />
                              <span className="text-xs text-gray-500">第 {i + 1} 段</span>
                            </label>
                            <AutoHeightTextarea
                              value={chunk}
                              onChange={(e) => updateSplitChunk(i, e.target.value)}
                              className="flex-1 p-2 text-sm leading-relaxed border rounded w-full"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="border rounded-lg overflow-hidden">
                          <div className="grid grid-cols-2 gap-px bg-gray-200">
                            <p className="col-span-1 px-3 py-2 bg-gray-100 text-xs text-gray-500 shrink-0">优化前</p>
                            <p className="col-span-1 px-3 py-2 bg-emerald-50 text-xs text-gray-500 shrink-0">优化后</p>
                          </div>
                          <div className="min-h-[300px] max-h-[75vh] overflow-y-auto">
                            <div className="grid grid-cols-2 gap-px bg-gray-200 [&>*]:min-h-[4rem]">
                              {optimizedResult.flatMap((item, i) => [
                                <div
                                  key={`l-${i}`}
                                  className="p-3 bg-gray-50 flex flex-col"
                                >
                                  <span className="text-xs text-gray-400 shrink-0">第 {i + 1} 段</span>
                                  <p className="text-base leading-relaxed text-gray-800 whitespace-pre-wrap flex-1 mt-1">
                                    {item.original}
                                  </p>
                                  {item.similar.length > 0 && (
                                    <details className="mt-2 shrink-0" open={false}>
                                      <summary className="text-xs text-indigo-600 cursor-pointer hover:underline">
                                        相似语料（{item.similar.length} 条）
                                      </summary>
                                      <ul className="mt-2 space-y-2 pl-2 border-l-2 border-indigo-200">
                                        {item.similar.map((s, j) => (
                                          <li key={j} className="text-sm">
                                            <span className="text-indigo-600 font-medium">
                                              相似度 {(s.similarity * 100).toFixed(0)}%
                                            </span>
                                            {s.title && (
                                              <span className="text-gray-500 ml-1">· {s.title}</span>
                                            )}
                                            <p className="mt-0.5 text-gray-700">{s.content}</p>
                                          </li>
                                        ))}
                                      </ul>
                                    </details>
                                  )}
                                </div>,
                                <div
                                  key={`r-${i}`}
                                  className="p-3 bg-emerald-50/50 flex flex-col"
                                >
                                  <span className="text-xs text-gray-400 shrink-0">第 {i + 1} 段</span>
                                  <p className="text-base leading-relaxed text-emerald-800 whitespace-pre-wrap flex-1 mt-1">
                                    {item.optimized}
                                  </p>
                                </div>,
                              ])}
                            </div>
                          </div>
                        </div>
                        {optimizedDocxBase64 && (
                          <button
                            type="button"
                            onClick={() => {
                              const blob = new Blob(
                                [Uint8Array.from(atob(optimizedDocxBase64), (c) => c.charCodeAt(0))],
                                {
                                  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                }
                              );
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = "optimized-paper.docx";
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="px-4 py-2 border rounded-md hover:bg-gray-50"
                          >
                            再次下载合并后的 .docx
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <p className="text-sm text-amber-600">请先完成步骤 1 上传论文。</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
