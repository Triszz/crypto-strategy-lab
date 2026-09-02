/**
 * Generic typed REST client for the frontend.
 *
 * Wraps `fetch` and enforces the standard backend envelope:
 *
 *   Success: { success: true, data: T, meta?: ResponseMeta }
 *   Error:   { success: false, error: { code, message, details? } }
 *
 * On HTTP 2xx we return `data` (T). On any other status we throw a
 * typed `HttpError` so callers can react with `try/catch` and render
 * a user-facing message without inspecting the response shape.
 *
 * The base URL is taken from `VITE_API_URL` at build time, defaulting
 * to `http://localhost:3000` for dev. Vite also proxies `/api` and
 * `/socket.io` from the dev server, so both relative and absolute
 * URLs work locally.
 */

export interface ResponseMeta {
  requestId?: string;
  timestamp?: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  constructor(status: number, body: ApiErrorBody) {
    super(`[${status}] ${body.code}: ${body.message}`);
    this.name = "HttpError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

/** Discriminated union of the standard backend envelope. */
type Envelope<T> =
  | { success: true; data: T; meta?: ResponseMeta }
  | { success: false; error: ApiErrorBody; meta?: ResponseMeta };

const BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:3000";

interface RequestOptions {
  signal?: AbortSignal;
}

/** Internal: parse JSON envelope and unwrap `data` (or throw). */
async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: opts.signal,
  };

  const res = await fetch(`${BASE}${path}`, init);

  // Some 202 endpoints return empty bodies (not in our case, but safe).
  if (res.status === 204) return undefined as T;

  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    throw new HttpError(res.status, {
      code: "INVALID_JSON",
      message: `Response was not valid JSON (HTTP ${res.status})`,
    });
  }

  if (!res.ok || !json || json.success === false) {
    const errBody = json && json.success === false
      ? json.error
      : { code: "HTTP_ERROR", message: `Request failed with HTTP ${res.status}` };
    throw new HttpError(res.status, errBody);
  }

  return json.data;
}

export const http = {
  get: <T>(path: string, opts?: RequestOptions) =>
    request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("POST", path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("PUT", path, body, opts),
  delete: <T>(path: string, opts?: RequestOptions) =>
    request<T>("DELETE", path, undefined, opts),
};
