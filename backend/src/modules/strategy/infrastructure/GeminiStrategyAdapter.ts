/**
 * strategy · infrastructure · GeminiStrategyAdapter
 *
 * Calls Google Gemini's generateContent API to translate a natural
 * language description into a structured StrategyEngineJson.
 *
 * The adapter is intentionally thin:
 *   - Builds a deterministic prompt that includes the BASE strategy list
 *     as reference examples.
 *   - Calls Gemini with the prompt.
 *   - Parses the model output (raw text → JSON) and validates it.
 *   - Returns either a StrategyEngineJson or a clear error.
 *
 * Configuration via env:
 *   - GEMINI_API_KEY (REQUIRED) — falls back to empty string in env.ts.
 *   - GEMINI_MODEL     (OPTIONAL, default "gemini-2.0-flash")
 *
 * This is the only file in the project that talks to a third-party LLM.
 * Higher layers (services, routes) depend on the abstract
 * `StrategyLlmAdapter` port so the implementation can be swapped or
 * mocked.
 */
import type { StrategyEngineJson } from "../domain/StrategyEngineJson";

const GEMINI_ENDPOINT_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

const DEFAULT_MODEL = "gemini-3.6-flash";

const SYSTEM_INSTRUCTION = `You translate a natural-language strategy description into a single strict JSON object that matches the project's BASE strategy schema.

Output ONLY the JSON object. No markdown. No commentary. No leading or trailing characters.

The JSON MUST follow this TypeScript shape (no extra fields, all keys required unless marked with ?):

{
  "name": string (<= 255 chars, snake_case or TitleCase),
  "version": "1.0.0",
  "description": string (<= 1000 chars, English or Vietnamese; summarise the intent),
  "family": one of "TREND" | "MOMENTUM" | "STRUCTURE" | "VOLATILITY" | "SENTIMENT",
  "implementationRef": "strategy.user.<short-id>",
  "parameterSpec": { "fields": ParameterField[] },
  "parameters": { ... },     // concrete values matching parameterSpec
  "requiredHistory": integer >= 2,
  "supportedTimeframes": ["1m","5m","15m","1h","4h","1d"],
  "timeframe": "1h",         // the most common default
  "tags": string[],          // short labels e.g. ["RSI","Mean Reversion"]
}

ParameterField shape:
{ "key": string, "kind": "integer"|"decimal"|"enum", "min"?: number, "max"?: number, "enumValues"?: string[], "default": number|string, "description"?: string }

Family guidance (pick the closest):
  TREND       — moving averages, crossovers, EMA ribbons, breakout
  MOMENTUM    — RSI, MACD, Stochastic, ROC
  STRUCTURE   — support / resistance, swing highs/lows, market structure
  VOLATILITY  — Bollinger Bands, ATR bands, Keltner
  SENTIMENT   — funding rate, fear/greed, news-driven

Rules:
  1. Keep parameter count <= 5.
  2. Every parameter declared in parameterSpec MUST appear in "parameters".
  3. Integer parameters: min <= max, default inside range.
  4. Decimal parameters: min <= max, default inside range.
  5. Enum parameters: enumValues has >= 1 entry; default is one of them.
  6. timeframe MUST be one of the supportedTimeframes.
  7. If the user mentions "RSI", add parameters period, buyThreshold, sellThreshold with cross-field rule implied (buy < sell).
  8. If the user mentions "MA" or "moving average", add fastPeriod and slowPeriod with cross-field rule implied (fast < slow).
  9. If the user mentions "Bollinger Bands", add period and stdDevMultiplier.
  10. If a stop loss / take profit is mentioned, capture them as a single "riskManagement" enum-free text parameter named "riskMode" with default "fixed_pct" (this is a hint, optional).
  11. requiredHistory = max(period, 50) typically; never less than 20.

When in doubt, prefer the simplest interpretation. Do NOT include code. Output is JSON only.`;

export interface LlmGenerateOptions {
  /** Override the default Gemini model. */
  readonly model?: string;
  /** Optional temperature override (default 0.2 for determinism). */
  readonly temperature?: number;
}

export interface LlmGenerateError {
  readonly code: "NOT_CONFIGURED" | "NETWORK" | "PARSE" | "SCHEMA" | "BLOCKED";
  readonly message: string;
  readonly details?: unknown;
}

export type LlmGenerateResult =
  | {
      readonly ok: true;
      readonly json: StrategyEngineJson;
      readonly raw: string;
    }
  | { readonly ok: false; readonly error: LlmGenerateError };

/**
 * Adapter contract. Higher layers depend on this; the concrete
 * implementation (GeminiStrategyAdapter) lives below.
 */
export interface StrategyLlmAdapter {
  isConfigured(): boolean;
  generateFromPrompt(
    prompt: string,
    options?: LlmGenerateOptions,
  ): Promise<LlmGenerateResult>;
}

interface GeminiResponseBody {
  readonly candidates?: ReadonlyArray<{
    readonly content?: {
      readonly parts?: ReadonlyArray<{ readonly text?: string }>;
    };
    readonly finishReason?: string;
  }>;
  readonly promptFeedback?: { readonly blockReason?: string };
  readonly error?: { readonly message?: string; readonly code?: number };
}

/**
 * Gemini-backed implementation of `StrategyLlmAdapter`.
 */
export class GeminiStrategyAdapter implements StrategyLlmAdapter {
  public constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string = DEFAULT_MODEL,
  ) {}

  public isConfigured(): boolean {
    return this.apiKey.trim().length > 0;
  }

  public async generateFromPrompt(
    prompt: string,
    options: LlmGenerateOptions = {},
  ): Promise<LlmGenerateResult> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: {
          code: "NOT_CONFIGURED",
          message:
            "GEMINI_API_KEY is not configured. Set GEMINI_API_KEY in the backend .env to enable prompt-driven strategy generation.",
        },
      };
    }

    const model = options.model ?? this.defaultModel;
    const temperature = options.temperature ?? 0.2;

    const url = `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
      },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "NETWORK",
          message: `Failed to reach Gemini: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }

    let parsed: GeminiResponseBody;
    try {
      parsed = (await res.json()) as GeminiResponseBody;
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "PARSE",
          message: `Gemini returned non-JSON response (HTTP ${res.status}).`,
        },
      };
    }

    if (!res.ok || parsed.error) {
      return {
        ok: false,
        error: {
          code: "NETWORK",
          message:
            parsed.error?.message ??
            `Gemini responded with HTTP ${res.status}.`,
        },
      };
    }

    if (parsed.promptFeedback?.blockReason) {
      return {
        ok: false,
        error: {
          code: "BLOCKED",
          message: `Gemini blocked the prompt: ${parsed.promptFeedback.blockReason}.`,
        },
      };
    }

    const rawText = parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const cleaned = stripCodeFences(rawText).trim();
    if (cleaned.length === 0) {
      return {
        ok: false,
        error: { code: "PARSE", message: "Gemini returned empty output." },
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(cleaned);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "PARSE",
          message: `Gemini output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          details: { raw: cleaned.slice(0, 500) },
        },
      };
    }

    return { ok: true, json: json as StrategyEngineJson, raw: cleaned };
  }
}

function stripCodeFences(s: string): string {
  // Some models wrap JSON in ```json ... ``` even when asked not to.
  const trimmed = s.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const inner = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return inner;
}

/**
 * Factory that picks the configured adapter based on environment.
 * The current project standardises on Gemini; swap here when needed.
 */
export function buildDefaultStrategyLlmAdapter(): StrategyLlmAdapter {
  const key = process.env["GEMINI_API_KEY"] ?? "";
  const model = process.env["GEMINI_MODEL"] ?? DEFAULT_MODEL;
  return new GeminiStrategyAdapter(key, model);
}
