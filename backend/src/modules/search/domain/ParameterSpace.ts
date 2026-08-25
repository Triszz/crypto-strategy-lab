/**
 * search · domain · ParameterSpace
 *
 * Declarative description of a parameter search space for ONE strategy. Built
 * from a `Strategy`'s `ParamSpec` by the generator and used by both
 * RandomGenerator and DomainGuidedGenerator to produce concrete parameter
 * sets.
 *
 * This is NOT the `ParamSpec` itself — `ParamSpec` is a schema declaration
 * used for validation; `ParameterSpace` describes the GRID of values to
 * explore and is used by the Search domain only.
 *
 * Architectural note: `ParameterSpace` is derived from `ParamSpec`. The
 * Search domain NEVER re-implements a strategy's parameter validation logic.
 * It builds a space from the declared bounds and the generator fills it.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 */
import type { ParamSpec } from "../../strategy/domain/ParamSpec";

/**
 * The kinds of parameter spaces that can be constructed from a `ParamField`.
 *  - `integer`: uniformly random integer in [min, max].
 *  - `decimal`:  uniformly random floating-point number in [min, max].
 *  - `enum`:    uniformly random choice from `values`.
 *
 * Step-based grid enumeration is not implemented in the MVP. Both generators
 * produce random values within the declared bounds.
 */
export type ParameterSpaceKind = "integer" | "decimal" | "enum";

/**
 * One dimension of the search space. Corresponds to one `ParamField` from
 * a `Strategy.parameterSpec`.
 */
export interface ParameterSpaceField {
  /** Matches `ParamField.key`. */
  readonly key: string;
  readonly kind: ParameterSpaceKind;
  readonly min?: number;    // for integer / decimal
  readonly max?: number;      // for integer / decimal
  readonly values?: ReadonlyArray<string>; // for enum
  /** Canonical default value (from `ParamField.default`). */
  readonly defaultValue: number | string;
}

/**
 * The complete search space for one `Strategy`. Built by calling
 * `buildParameterSpace(strategy.parameterSpec)`.
 */
export interface ParameterSpace {
  /** The `Strategy.id` / `implementationRef` this space belongs to. */
  readonly strategyId: string;
  /** One field per parameter in the strategy's `ParamSpec`. Ordered by spec field order. */
  readonly fields: ReadonlyArray<ParameterSpaceField>;
  /** The total count of discrete grid points (product of value counts). Infinity for unbounded. */
  readonly totalGridPoints: number;
}

/**
 * Build a `ParameterSpace` from a `Strategy`'s `ParamSpec`. The space
 * is the Cartesian product of each field's declared range/enum values.
 *
 * For `integer` fields: the generator will sample uniformly from [min, max]
 * (inclusive integers). No step is applied.
 *
 * For `decimal` fields: the generator will sample uniformly from [min, max].
 *
 * For `enum` fields: the generator will pick uniformly from `enumValues`.
 *
 * Returns `null` when the spec contains fields with no declared bounds
 * (e.g. an unbounded `decimal` without `min`/`max`) — such spaces are
 * invalid for generation and should be rejected by the generator.
 */
export function buildParameterSpace(
  strategyId: string,
  spec: ParamSpec,
): ParameterSpace | null {
  const fields: ParameterSpaceField[] = [];
  let totalGridPoints = 1;

  for (const field of spec.fields) {
    let spaceField: ParameterSpaceField;

    switch (field.kind) {
      case "integer": {
        if (field.min === undefined || field.max === undefined) {
          return null; // unbounded integer space
        }
        const count = Math.floor(field.max) - Math.ceil(field.min) + 1;
        if (count <= 0) return null;
        totalGridPoints *= count;
        spaceField = {
          key: field.key,
          kind: "integer",
          min: field.min,
          max: field.max,
          defaultValue: field.default,
        };
        break;
      }
      case "decimal": {
        if (field.min === undefined || field.max === undefined) {
          return null; // unbounded decimal space
        }
        totalGridPoints = Infinity; // continuous range — cannot enumerate
        spaceField = {
          key: field.key,
          kind: "decimal",
          min: field.min,
          max: field.max,
          defaultValue: field.default,
        };
        break;
      }
      case "enum": {
        const values = field.enumValues ?? [];
        if (values.length === 0) return null;
        totalGridPoints *= values.length;
        spaceField = {
          key: field.key,
          kind: "enum",
          values,
          defaultValue: field.default,
        };
        break;
      }
    }

    fields.push(spaceField);
  }

  return { strategyId, fields, totalGridPoints };
}
