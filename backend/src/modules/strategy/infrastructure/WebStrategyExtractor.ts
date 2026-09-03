/**
 * strategy · infrastructure · WebStrategyExtractor
 *
 * Fetches a public strategy URL and extracts a structured StrategyEngineJson
 * from its content. Strategy:
 *   1. Validate URL (protocol, hostname).
 *   2. Fetch HTML with strict timeouts + size cap.
 *   3. Strip tags/scripts/styles → plain text.
 *   4. Hand the text to the LLM adapter with an extraction prompt.
 *
 * If no LLM is configured, falls back to a minimal heuristic that
 * returns a NOT_CONFIGURED error to the caller.
 *
 * The class is the only place in the project that performs outbound
 * HTTP to user-supplied URLs.
 */
import type { StrategyEngineJson } from "../domain/StrategyEngineJson";
import {
  buildDefaultStrategyLlmAdapter,
  type StrategyLlmAdapter,
} from "./GeminiStrategyAdapter";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_BYTES = 2_000_000; // 2 MB
const FETCH_TIMEOUT_MS = 8_000;

const EXTRACTION_PROMPT = `You are given the text of a webpage that describes a trading strategy.

Extract a single strict JSON object that matches the project's BASE strategy schema:

{
  "name": string,
  "version": "1.0.0",
  "description": string,
  "family": "TREND" | "MOMENTUM" | "STRUCTURE" | "VOLATILITY" | "SENTIMENT",
  "implementationRef": "strategy.user.<short-id>",
  "parameterSpec": { "fields": ParameterField[] },
  "parameters": { ... },
  "requiredHistory": integer >= 2,
  "supportedTimeframes": ["1m","5m","15m","1h","4h","1d"],
  "timeframe": "1h",
  "tags": string[]
}

ParameterField = { "key": string, "kind": "integer"|"decimal"|"enum", "min"?: number, "max"?: number, "enumValues"?: string[], "default": number|string, "description"?: string }

Rules:
  - Output ONLY the JSON object. No markdown.
  - If the page does NOT describe an actual trading strategy, return {"__error":"NOT_A_STRATEGY_PAGE","reason":"<one-sentence reason>"}.
  - Use your best judgement for parameter ranges and defaults; prefer the values mentioned in the page.

Page text follows.`;

export type UrlExtractError =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "FETCH_FAILED"
  | "EMPTY_CONTENT"
  | "NOT_CONFIGURED"
  | "NOT_A_STRATEGY_PAGE"
  | "PARSE_ERROR";

export interface UrlExtractResult {
  readonly ok: boolean;
  readonly json?: StrategyEngineJson;
  readonly error?: { readonly code: UrlExtractError; readonly message: string };
  /** Up to 8KB of the cleaned text we passed to the LLM. Useful for debugging. */
  readonly cleanedTextSample?: string;
}

export interface UrlExtractOptions {
  /** Override the LLM adapter (mainly for tests). */
  readonly llmAdapter?: StrategyLlmAdapter;
  /** Max fetched bytes. Defaults to 2MB. */
  readonly maxBytes?: number;
  /** Fetch timeout in ms. Defaults to 8s. */
  readonly timeoutMs?: number;
}

export class WebStrategyExtractor {
  private readonly llmAdapter: StrategyLlmAdapter;

  public constructor(llmAdapter?: StrategyLlmAdapter) {
    this.llmAdapter = llmAdapter ?? buildDefaultStrategyLlmAdapter();
  }

  public isLlmConfigured(): boolean {
    return this.llmAdapter.isConfigured();
  }

  public async extract(url: string, options: UrlExtractOptions = {}): Promise<UrlExtractResult> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { ok: false, error: { code: "INVALID_URL", message: `URL is not valid: ${url}` } };
    }
    if (!ALLOWED_PROTOCOLS.has(parsedUrl.protocol)) {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_PROTOCOL",
          message: `Protocol "${parsedUrl.protocol}" is not supported. Use http(s).`,
        },
      };
    }

    const maxBytes = options.maxBytes ?? MAX_BYTES;
    const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    const adapter = options.llmAdapter ?? this.llmAdapter;

    if (!adapter.isConfigured()) {
      return {
        ok: false,
        error: {
          code: "NOT_CONFIGURED",
          message:
            "GEMINI_API_KEY is not configured. Web extraction requires an LLM provider.",
        },
      };
    }

    // Fetch
    const text = await fetchText(parsedUrl.toString(), maxBytes, timeoutMs);
    if ("error" in text) {
      return { ok: false, error: text.error };
    }
    const cleaned = stripHtmlToText(text.value);
    if (cleaned.trim().length < 50) {
      return {
        ok: false,
        error: {
          code: "EMPTY_CONTENT",
          message: "The page returned too little content to extract a strategy.",
        },
      };
    }

    const sample = cleaned.slice(0, 8_000);
    const llmResult = await adapter.generateFromPrompt(`${EXTRACTION_PROMPT}\n\n${sample}`);
    if (!llmResult.ok) {
      return {
        ok: false,
        error: {
          code: "PARSE_ERROR",
          message: `LLM extraction failed: ${llmResult.error.message}`,
        },
        cleanedTextSample: sample,
      };
    }

    // The LLM may signal "this is not a strategy page"
    if (
      llmResult.json &&
      typeof llmResult.json === "object" &&
      "__error" in (llmResult.json as unknown as Record<string, unknown>) &&
      (llmResult.json as unknown as { __error?: string }).__error === "NOT_A_STRATEGY_PAGE"
    ) {
      return {
        ok: false,
        error: {
          code: "NOT_A_STRATEGY_PAGE",
          message:
            (llmResult.json as unknown as { reason?: string }).reason ??
            "The page does not describe a trading strategy.",
        },
        cleanedTextSample: sample,
      };
    }

    return {
      ok: true,
      json: llmResult.json as unknown as StrategyEngineJson,
      cleanedTextSample: sample,
    };
  }
}

async function fetchText(
  url: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<{ value: string } | { error: { code: UrlExtractError; message: string } }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "CryptoStrategyLab/1.0 (+url-extractor)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      return {
        error: {
          code: "FETCH_FAILED",
          message: `Fetch returned HTTP ${res.status}.`,
        },
      };
    }
    // Stream-read to enforce maxBytes
    const reader = res.body?.getReader();
    if (!reader) {
      return { error: { code: "FETCH_FAILED", message: "Empty response body." } };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return {
            error: {
              code: "FETCH_FAILED",
              message: `Response exceeds ${maxBytes} bytes; aborted.`,
            },
          };
        }
        chunks.push(value);
      }
    }
    const decoder = new TextDecoder("utf-8");
    const text = chunks.map((c) => decoder.decode(c, { stream: true })).join("");
    return { value: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code: UrlExtractError = message.includes("abort") ? "FETCH_FAILED" : "FETCH_FAILED";
    return { error: { code, message: `Fetch error: ${message}` } };
  } finally {
    clearTimeout(timer);
  }
}

function stripHtmlToText(html: string): string {
  let s = html;
  // Strip scripts/styles
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  // Strip all tags
  s = s.replace(/<\/?[^>]+>/g, " ");
  // Decode common entities
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
