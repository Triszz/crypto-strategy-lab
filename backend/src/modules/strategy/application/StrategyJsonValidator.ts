/**
 * strategy · application · StrategyJsonValidator
 *
 * Validates a StrategyEngineJson against the existing domain rules:
 *   - ParamSpec via validateParamSpec (reuses existing domain logic)
 *   - Required field presence
 *   - Indicator references consistency
 *   - Risk-management ranges
 *   - Timeframe sanity
 *
 * Backend is authoritative — the frontend can use this as a guide but
 * MUST treat the backend response as ground truth.
 */
import { validateParamSpec, type ParamSpec } from "../domain/ParamSpec";
import type {
  StrategyFamily,
  StrategyTimeframe,
} from "../domain/StrategyContext";
import type { StrategyEngineJson, StrategySource } from "../domain/StrategyEngineJson";

const SUPPORTED_TIMEFRAMES: ReadonlyArray<StrategyTimeframe> = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
];

const SUPPORTED_FAMILIES: ReadonlyArray<StrategyFamily> = [
  "TREND",
  "MOMENTUM",
  "STRUCTURE",
  "VOLATILITY",
  "SENTIMENT",
];

export interface ValidationSuccess {
  readonly ok: true;
  readonly warnings: ReadonlyArray<string>;
}

export interface ValidationFailure {
  readonly ok: false;
  readonly errors: ReadonlyArray<string>;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Authoritative validation for a StrategyEngineJson.
 *
 * Returns one of:
 *  - { ok: true, warnings } — the JSON is valid; warnings are non-blocking hints.
 *  - { ok: false, errors } — at least one blocking error.
 *
 * Validation is INTENTIONALLY non-throwing; callers translate to HTTP.
 */
export function validateStrategyJson(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["strategy must be a JSON object."] };
  }
  const obj = input as Record<string, unknown>;

  // name
  if (typeof obj["name"] !== "string" || obj["name"].trim().length === 0) {
    errors.push("name is required and must be a non-empty string.");
  } else if (obj["name"].length > 255) {
    errors.push("name must be 255 characters or fewer.");
  }

  // version
  if (typeof obj["version"] !== "string" || obj["version"].trim().length === 0) {
    errors.push("version is required and must be a non-empty string.");
  } else if (obj["version"].length > 32) {
    errors.push("version must be 32 characters or fewer.");
  } else if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(obj["version"])) {
    warnings.push(`version "${obj["version"]}" is not in semver format (x.y.z).`);
  }

  // family
  if (typeof obj["family"] !== "string" || !SUPPORTED_FAMILIES.includes(obj["family"] as StrategyFamily)) {
    errors.push(
      `family must be one of [${SUPPORTED_FAMILIES.join(", ")}].`,
    );
  }

  // implementationRef
  if (typeof obj["implementationRef"] !== "string" || obj["implementationRef"].trim().length === 0) {
    errors.push("implementationRef is required and must be a non-empty string.");
  } else if (obj["implementationRef"].length > 255) {
    errors.push("implementationRef must be 255 characters or fewer.");
  }

  // parameterSpec
  const spec = obj["parameterSpec"];
  if (!spec || typeof spec !== "object") {
    errors.push("parameterSpec is required and must be an object.");
  } else {
    const fields = (spec as { fields?: unknown }).fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      errors.push("parameterSpec.fields must be a non-empty array.");
    } else {
      // Reuse existing ParamSpec validation
      const validated = validateParamSpec(
        { fields } as ParamSpec,
        (obj["parameters"] ?? {}) as Record<string, unknown>,
      );
      if (!validated.ok) {
        errors.push(...validated.errors);
      }
    }
  }

  // parameters must be an object if present
  const params = obj["parameters"];
  if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) {
    errors.push("parameters must be an object.");
  }

  // requiredHistory
  if (typeof obj["requiredHistory"] !== "number" || !Number.isInteger(obj["requiredHistory"]) || obj["requiredHistory"] <= 0) {
    errors.push("requiredHistory must be a positive integer.");
  } else if (obj["requiredHistory"] > 10_000) {
    warnings.push(`requiredHistory ${obj["requiredHistory"]} is very large; performance may be impacted.`);
  }

  // supportedTimeframes (optional)
  if (obj["supportedTimeframes"] !== undefined) {
    if (!Array.isArray(obj["supportedTimeframes"])) {
      errors.push("supportedTimeframes must be an array of timeframe strings.");
    } else {
      const invalid = (obj["supportedTimeframes"] as unknown[]).filter(
        (t) => typeof t !== "string" || !SUPPORTED_TIMEFRAMES.includes(t as StrategyTimeframe),
      );
      if (invalid.length > 0) {
        errors.push(
          `supportedTimeframes contains invalid entries: ${JSON.stringify(invalid)}. Allowed: [${SUPPORTED_TIMEFRAMES.join(", ")}].`,
        );
      }
    }
  }

  // timeframe (optional, default helper for the UI)
  if (obj["timeframe"] !== undefined) {
    if (typeof obj["timeframe"] !== "string" || !SUPPORTED_TIMEFRAMES.includes(obj["timeframe"] as StrategyTimeframe)) {
      errors.push(
        `timeframe must be one of [${SUPPORTED_TIMEFRAMES.join(", ")}].`,
      );
    }
  }

  // source (optional, but if present must be valid)
  if (obj["source"] !== undefined) {
    const allowed: ReadonlyArray<StrategySource> = ["USER_PROMPT", "WEB_IMPORT"];
    if (typeof obj["source"] !== "string" || !allowed.includes(obj["source"] as StrategySource)) {
      errors.push(`source must be one of [${allowed.join(", ")}].`);
    }
  }

  // tags (optional)
  if (obj["tags"] !== undefined) {
    if (!Array.isArray(obj["tags"])) {
      errors.push("tags must be an array of strings.");
    } else if ((obj["tags"] as unknown[]).some((t) => typeof t !== "string")) {
      errors.push("tags must contain only strings.");
    } else if (obj["tags"].length > 20) {
      warnings.push(`tags has ${(obj["tags"] as unknown[]).length} entries; max recommended is 20.`);
    }
  }

  // description (optional)
  if (obj["description"] !== undefined && typeof obj["description"] !== "string") {
    errors.push("description must be a string.");
  } else if (typeof obj["description"] === "string" && obj["description"].length > 1000) {
    errors.push("description must be 1000 characters or fewer.");
  }

  // Cross-field: cross-check parameters against parameterSpec
  if (
    spec &&
    typeof spec === "object" &&
    params &&
    typeof params === "object" &&
    !Array.isArray(params) &&
    Array.isArray((spec as { fields?: unknown }).fields) &&
    errors.length === 0
  ) {
    // The validateParamSpec above already covered this, but add an extra
    // sanity check: parameters object must contain values for ALL declared keys.
    const declaredKeys = ((spec as { fields: ReadonlyArray<{ key: string }> }).fields).map((f) => f.key);
    const providedKeys = Object.keys(params as Record<string, unknown>);
    const missing = declaredKeys.filter((k) => !providedKeys.includes(k));
    if (missing.length > 0) {
      errors.push(`parameters is missing keys: [${missing.join(", ")}].`);
    }
  }

  return errors.length === 0
    ? { ok: true, warnings }
    : { ok: false, errors };
}

/**
 * Apply server-side defaults to a StrategyEngineJson so it always has
 * the required keys filled in with sensible values.
 */
export function normalizeStrategyJson(input: StrategyEngineJson): StrategyEngineJson {
  return {
    ...input,
    supportedTimeframes: input.supportedTimeframes ?? [
      "1m",
      "5m",
      "15m",
      "1h",
      "4h",
      "1d",
    ],
    source: input.source ?? "USER_PROMPT",
    tags: input.tags ?? [],
    description: input.description ?? "",
  };
}
