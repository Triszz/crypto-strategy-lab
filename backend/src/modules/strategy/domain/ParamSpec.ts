/**
 * strategy · domain · ParamSpec
 *
 * Declarative parameter schema a Strategy exposes so that future Search
 * generators (RandomGenerator, DomainGuidedGenerator) and UI forms can
 * describe the legal parameter space WITHOUT understanding the
 * concrete strategy's internals.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 *
 * The runtime contract is `Strategy.validateParameters(p)`, which is
 * authoritative. ParamSpec is a *declarative hint* used for ergonomic
 * generation / UI. A Strategy MAY use ParamSpec as the source of its
 * validator or it MAY implement validator-only logic — both are
 * acceptable as long as `validateParameters` is the runtime gate.
 */

/**
 * Discriminator for the kind of value a parameter accepts.
 *  - `integer` : whole numbers (`min ≤ value ≤ max`, both optional).
 *  - `decimal` : floating point (`min ≤ value ≤ max`, both optional).
 *  - `enum`    : one of `enumValues`.
 */
export type ParamKind = "integer" | "decimal" | "enum";

/**
 * One parameter declaration.
 */
export interface ParamField {
  /** Stable key used as the JSON property name (e.g. `"period"`). */
  readonly key: string;
  readonly kind: ParamKind;
  /** Inclusive lower bound. Required for `integer` / `decimal` if defined. */
  readonly min?: number;
  /** Inclusive upper bound. Required for `integer` / `decimal` if defined. */
  readonly max?: number;
  /** Required when `kind === "enum"`. */
  readonly enumValues?: ReadonlyArray<string>;
  /** Canonical default value used by `Strategy.defaultParameters()`. */
  readonly default: number | string;
  /** Optional UI hint, e.g. `"Lookback window length."`. */
  readonly description?: string;
}

/**
 * A complete parameter schema for one Strategy.
 */
export interface ParamSpec {
  readonly fields: ReadonlyArray<ParamField>;
}

/**
 * Result of validating a parameter object against a ParamSpec.
 *
 * The runtime contract is `Strategy.validateParameters(p)` which uses
 * ParamSpec (or its own logic) and returns one of these. Strategy code
 * SHOULD call `validateParamSpec(spec, parameters)` to stay aligned with
 * the declared spec.
 */
export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

/**
 * Validate a parameter object against a ParamSpec. Returns a
 * `ValidationResult`. Intended for use by Strategy implementations as
 * the body of `Strategy.validateParameters(p)`. This function is the
 * canonical helper; concrete strategies MAY layer additional checks
 * on top (e.g. cross-field rules like "fast period < slow period").
 *
 * The function is intentionally exhaustive and produces one error
 * string per violation so the Backtester / Search can log them.
 */
export function validateParamSpec(
  spec: ParamSpec,
  parameters: Readonly<Record<string, unknown>>,
): ValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const field of spec.fields) {
    seen.add(field.key);
    const value = parameters[field.key];

    if (value === undefined || value === null) {
      errors.push(`Parameter "${field.key}" is required.`);
      continue;
    }

    switch (field.kind) {
      case "integer": {
        if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
          errors.push(`Parameter "${field.key}" must be an integer.`);
          break;
        }
        if (field.min !== undefined && value < field.min) {
          errors.push(`Parameter "${field.key}" must be ≥ ${field.min}.`);
        }
        if (field.max !== undefined && value > field.max) {
          errors.push(`Parameter "${field.key}" must be ≤ ${field.max}.`);
        }
        break;
      }
      case "decimal": {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push(`Parameter "${field.key}" must be a finite number.`);
          break;
        }
        if (field.min !== undefined && value < field.min) {
          errors.push(`Parameter "${field.key}" must be ≥ ${field.min}.`);
        }
        if (field.max !== undefined && value > field.max) {
          errors.push(`Parameter "${field.key}" must be ≤ ${field.max}.`);
        }
        break;
      }
      case "enum": {
        const allowed = field.enumValues ?? [];
        if (typeof value !== "string" || !allowed.includes(value)) {
          errors.push(
            `Parameter "${field.key}" must be one of [${allowed.join(", ")}].`,
          );
        }
        break;
      }
    }
  }

  for (const key of Object.keys(parameters)) {
    if (!seen.has(key)) {
      errors.push(`Unknown parameter "${key}".`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Build a default parameter object from a ParamSpec by taking each
 * declared field's `default`. This is the canonical way to implement
 * `Strategy.defaultParameters()` for spec-driven strategies.
 */
export function defaultParametersFromSpec(spec: ParamSpec): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const field of spec.fields) {
    out[field.key] = field.default;
  }
  return out;
}