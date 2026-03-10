/** 使用 SiliconFlow API 生成 1024 维向量 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey?.trim()) throw new Error("未配置 SILICONFLOW_API_KEY");

  const results: number[][] = [];
  const batchSize = 16;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await fetch("https://api.siliconflow.cn/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "Qwen/Qwen3-Embedding-0.6B",
        input: batch.length === 1 ? batch[0] : batch,
        dimensions: 1024,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`SiliconFlow 嵌入失败: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    const vectors = data.data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
    results.push(...vectors);
  }
  return results;
}
