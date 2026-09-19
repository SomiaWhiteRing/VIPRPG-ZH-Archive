export async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `服务器未返回有效结果（${response.status}），请重新读取并确认状态`,
    );
  }
  if (!response.ok) {
    const failure = data as { detail?: string; error?: string } | null;
    throw new Error(
      failure?.detail || failure?.error || `请求失败（${response.status}）`,
    );
  }
  return data as T;
}
export function postJson<T>(url: string, data: unknown) {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
