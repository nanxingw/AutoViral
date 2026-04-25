export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: ApiOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function apiFetch<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = opts;
  const finalHeaders: Record<string, string> = { ...(headers as Record<string, string> | undefined) };
  const init: RequestInit = { ...rest, headers: finalHeaders };
  if (body !== undefined) {
    if (!finalHeaders["content-type"] && !finalHeaders["Content-Type"]) {
      finalHeaders["content-type"] = "application/json";
    }
    init.body = JSON.stringify(body);
  }

  const res = await fetch(buildUrl(path, query), init);
  const ct = res.headers.get("content-type") ?? "";
  const payload: unknown = ct.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) throw new ApiError(`${res.status} ${res.statusText}`, res.status, payload);
  return payload as T;
}
