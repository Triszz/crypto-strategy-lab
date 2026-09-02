/**
 * strategy · application · StrategyEngineService
 *
 * Orchestrates the Strategy Engine workflow:
 *   1. generateFromPrompt — call LLM, validate output, normalize
 *   2. importFromUrl       — fetch page, extract strategy via LLM, validate
 *   3. validateJson        — authoritative domain validation
 *   4. saveStrategy        — persist a validated JSON to the database
 *   5. listSavedStrategies — read recent saved records
 *   6. getSavedStrategy    — read one saved record
 *
 * MUST stay infrastructure-free: no Prisma, no Express. The concrete
 * adapters (LLM, URL extractor, repository) are injected.
 */
import type { Logger } from "../../../shared/logger/logger";
import { logger as rootLogger } from "../../../shared/logger/logger";
import type { StrategyEngineJson } from "../domain/StrategyEngineJson";
import {
  normalizeStrategyJson,
  validateStrategyJson,
  type ValidationResult,
} from "./StrategyJsonValidator";
import type { StrategyLlmAdapter, LlmGenerateResult } from "../infrastructure/GeminiStrategyAdapter";
import type {
  WebStrategyExtractor,
  UrlExtractResult,
} from "../infrastructure/WebStrategyExtractor";
import type {
  SavedStrategyRepository,
  SavedStrategyRecord,
  ListSavedStrategyFilter,
} from "./SavedStrategyRepository.port";

export interface GenerateFromPromptInput {
  readonly prompt: string;
  readonly source?: StrategyEngineJson["source"];
  readonly tags?: ReadonlyArray<string>;
  /** Override LLM adapter (tests). */
  readonly llmAdapter?: StrategyLlmAdapter;
}

export interface GenerateFromPromptResult {
  readonly ok: boolean;
  readonly json?: StrategyEngineJson;
  readonly validation?: ValidationResult;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface ImportFromUrlInput {
  readonly url: string;
  readonly tags?: ReadonlyArray<string>;
  readonly extractor?: WebStrategyExtractor;
}

export interface ImportFromUrlError {
  readonly code: string;
  readonly message: string;
}

export type ImportFromUrlResult =
  | (UrlExtractResult & { readonly ok: true; readonly json: StrategyEngineJson; readonly validation: ValidationResult })
  | (Omit<UrlExtractResult, "error"> & { readonly ok: false; readonly error: ImportFromUrlError; readonly validation?: ValidationResult });

export interface SaveStrategyInput {
  readonly json: StrategyEngineJson;
  /** Optional ownerId. Defaults to null when auth is unavailable. */
  readonly ownerId?: string | null;
}

export interface SaveStrategyResult {
  readonly ok: boolean;
  readonly record?: SavedStrategyRecord;
  readonly validation?: ValidationResult;
  readonly error?: { readonly code: string; readonly message: string };
}

export class StrategyEngineService {
  public constructor(
    private readonly savedRepository: SavedStrategyRepository,
    private readonly llmAdapter: StrategyLlmAdapter,
    private readonly urlExtractor: WebStrategyExtractor,
    private readonly log: Logger = rootLogger,
  ) {}

  // ─── Generation ─────────────────────────────────────────────────────

  public async generateFromPrompt(
    input: GenerateFromPromptInput,
  ): Promise<GenerateFromPromptResult> {
    if (!input.prompt || input.prompt.trim().length < 10) {
      return {
        ok: false,
        error: {
          code: "INVALID_PROMPT",
          message: "Prompt must be at least 10 characters.",
        },
      };
    }
    const adapter = input.llmAdapter ?? this.llmAdapter;
    if (!adapter.isConfigured()) {
      return {
        ok: false,
        error: {
          code: "NOT_CONFIGURED",
          message:
            "GEMINI_API_KEY is not configured. Set it in backend/.env to enable prompt-driven generation.",
        },
      };
    }

    const result: LlmGenerateResult = await adapter.generateFromPrompt(input.prompt);
    if (!result.ok) {
      return {
        ok: false,
        error: { code: result.error.code, message: result.error.message },
      };
    }

    return this.finalizeGenerated(result.json, input.tags, input.source);
  }

  public async importFromUrl(
    input: ImportFromUrlInput,
  ): Promise<ImportFromUrlResult> {
    const extractor = input.extractor ?? this.urlExtractor;
    const result = await extractor.extract(input.url);

    if (!result.ok || !result.json) {
      return {
        ok: false,
        error: {
          code: result.error?.code ?? "IMPORT_FAILED",
          message: result.error?.message ?? "Import failed",
        },
        cleanedTextSample: result.cleanedTextSample,
      };
    }

    const finalized = this.finalizeGenerated(result.json, input.tags, "WEB_IMPORT");
    if (!finalized.ok || !finalized.json) {
      return {
        ok: false,
        error: {
          code: finalized.error?.code ?? "SCHEMA",
          message: finalized.error?.message ?? "Schema validation failed",
        },
        validation: finalized.validation,
        cleanedTextSample: result.cleanedTextSample,
      };
    }
    return {
      ok: true,
      json: finalized.json,
      validation: finalized.validation ?? { ok: true, warnings: [] },
      cleanedTextSample: result.cleanedTextSample,
    };
  }

  // ─── Validation ─────────────────────────────────────────────────────

  public validateJson(json: unknown): ValidationResult {
    return validateStrategyJson(json);
  }

  // ─── Persistence ────────────────────────────────────────────────────

  public async saveStrategy(input: SaveStrategyInput): Promise<SaveStrategyResult> {
    const validation = validateStrategyJson(input.json);
    if (!validation.ok) {
      return { ok: false, validation, error: { code: "INVALID", message: validation.errors.join("; ") } };
    }

    const normalized = normalizeStrategyJson(input.json);
    try {
      const record = await this.savedRepository.create({
        name: normalized.name,
        version: normalized.version,
        description: normalized.description ?? null,
        jsonDef: normalized,
        source: normalized.source ?? "USER_PROMPT",
        tags: normalized.tags ?? [],
        ownerId: input.ownerId ?? null,
      });
      return { ok: true, record, validation };
    } catch (err) {
      this.log.error({ err }, "strategy-engine.save.error");
      return {
        ok: false,
        error: {
          code: "PERSIST_FAILED",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  public async listSavedStrategies(
    filter?: ListSavedStrategyFilter,
  ): Promise<ReadonlyArray<SavedStrategyRecord>> {
    return this.savedRepository.list(filter);
  }

  public async getSavedStrategy(id: string): Promise<SavedStrategyRecord | null> {
    return this.savedRepository.get(id);
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private finalizeGenerated(
    rawJson: unknown,
    tags?: ReadonlyArray<string>,
    source?: StrategyEngineJson["source"],
  ): GenerateFromPromptResult {
    const validation = validateStrategyJson(rawJson);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "SCHEMA",
          message: "LLM output did not satisfy the strategy schema.",
        },
        validation,
      };
    }
    const json = rawJson as StrategyEngineJson;
    const normalized: StrategyEngineJson = {
      ...normalizeStrategyJson(json),
      source: source ?? json.source ?? "USER_PROMPT",
      tags: tags && tags.length > 0 ? [...tags] : json.tags ?? [],
    };

    return {
      ok: true,
      json: normalized,
      validation: {
        ok: true,
        warnings: validation.warnings,
      },
    };
  }
}
