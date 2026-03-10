import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/** 构建时 env 不可用，用占位值让 createClient 通过，运行时会用真实 env */
const isBuildPhase = process.env.VERCEL === "1";

/** 延迟初始化，构建时 env 可能不可用，避免 supabaseUrl is required 报错 */
function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    (isBuildPhase ? "https://placeholder.supabase.co" : "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    (isBuildPhase ? "placeholder" : "");
  if (!url || !key) throw new Error("未配置 NEXT_PUBLIC_SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY");
  _client = createClient(url, key);
  return _client;
}

/** 服务端 Supabase 客户端（用于 API 写入），首次使用时才创建 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
