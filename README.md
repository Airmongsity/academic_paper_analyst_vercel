This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 环境变量

**PDF 解析**：使用 pdfjs-dist 本地解析，自动清洗页眉页脚和公式。语料切分使用 `@langchain/textsplitters` 的 `RecursiveCharacterTextSplitter`。

**向量化**（可选）：
- `NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（或 `NEXT_PUBLIC_SUPABASE_ANON_KEY`）：Supabase 连接
- `SILICONFLOW_API_KEY`：SiliconFlow 嵌入 API（1024 维）

**pgvector 表结构**：若建表时使用 `vector(1536)`，需改为 1024 维：
```sql
ALTER TABLE documents ALTER COLUMN embedding TYPE vector(1024);
```

**已解析论文缓存表**（用于跳过重复下载，需在 Supabase SQL 编辑器中执行）：
```sql
create table if not exists parsed_papers_cache (
  cache_key text primary key,
  title text,
  chunks jsonb not null default '[]',
  updated_at timestamptz default now()
);
```

**向量相似度检索**：在 Supabase SQL 编辑器中执行以下函数，供「优化论文」步骤使用：
```sql
create or replace function match_documents (
  query_embedding vector(1024),
  match_threshold float default 0.4,
  match_count int default 5
)
returns table (id bigint, content text, metadata jsonb, similarity float)
language sql stable
as $$
  select d.id, d.content, d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where d.embedding is not null
    and 1 - (d.embedding <=> query_embedding) > match_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
```

其他：`DEEPSEEK_API_KEY`、`SERPAPI_API_KEY`、`NCPSSD_BASE`、`NCPSSD_PDF_HEADED` 等按需配置。

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
