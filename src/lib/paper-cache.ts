import { supabase } from "@/lib/supabase";

export type PaperInput = {
  link: string;
  source?: "scholar" | "ncpssd";
  pdfUrl?: string;
  title?: string;
};

/** 生成论文缓存键：ncpssd 用 link，scholar 用 pdfUrl 或 link */
export function getPaperCacheKey(paper: PaperInput): string {
  if (paper.source === "ncpssd" && paper.link) {
    return `ncpssd:${paper.link}`;
  }
  const url = paper.pdfUrl?.trim() || paper.link;
  return `scholar:${url}`;
}

/** 从缓存读取已解析的 chunks，若无则返回 null */
export async function getCachedChunks(
  cacheKey: string
): Promise<{ title: string; chunks: string[] } | null> {
  try {
    const { data, error } = await supabase
      .from("parsed_papers_cache")
      .select("title, chunks")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (error || !data) return null;
    const chunks = Array.isArray(data.chunks) ? data.chunks : [];
    if (chunks.length === 0) return null;
    return { title: (data.title as string) ?? "未知", chunks };
  } catch {
    return null;
  }
}

/** 将解析结果写入缓存 */
export async function setCachedChunks(
  cacheKey: string,
  title: string,
  chunks: string[]
): Promise<void> {
  try {
    await supabase.from("parsed_papers_cache").upsert(
      {
        cache_key: cacheKey,
        title,
        chunks,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" }
    );
  } catch {
    // 静默失败，不影响主流程
  }
}
