/* Strategy presentation layer */
import type { Strategy } from "../domain/Strategy";
import type { ParamSpec } from "../domain/ParamSpec";
import type { StrategyParameters } from "../domain/StrategyContext";
import { getStrategyRegistry } from "../domain/StrategyRegistry";

function mapParamKind(kind: string): "integer" | "decimal" | "enum" {
  if (kind === "integer" || kind === "decimal" || kind === "enum") return kind;
  return "enum";
}

function mapParamField(field: ParamSpec["fields"][number]) {
  const base = {
    key: field.key,
    kind: mapParamKind(field.kind),
    description: field.description ?? null,
    defaultValue: field.default,
  };
  if (field.kind === "integer" || field.kind === "decimal") {
    return { ...base, min: field.min ?? null, max: field.max ?? null };
  }
  return { ...base, values: [...(field.enumValues ?? [])] };
}

function mapParamSpec(spec: ParamSpec) {
  return { fields: spec.fields.map(mapParamField) };
}

function hasCrossFieldRules(s: Strategy): boolean {
  return s.id === "strategy.ma" || s.id === "strategy.rsi";
}

export interface ParameterField {
  readonly key: string;
  readonly kind: "integer" | "decimal" | "enum";
  readonly description: string | null;
  readonly defaultValue: string | number;
  readonly min?: number | null;
  readonly max?: number | null;
  readonly values?: ReadonlyArray<string>;
}

export interface StrategyListItem {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly description: string | null;
  readonly type: "BASE";
  readonly requiredHistory: number;
  readonly supportedTimeframes: ReadonlyArray<string> | null;
  readonly parameterSpec: {
    readonly fields: ReadonlyArray<ParameterField>;
  };
}

export interface StrategyDetail extends StrategyListItem {
  readonly defaultParameters: StrategyParameters;
  readonly parameterValidation: {
    readonly hasCrossFieldRules: boolean;
  };
}

export class StrategyService {
  public list(): { strategies: StrategyListItem[]; total: number } {
    const registry = getStrategyRegistry();
    const ids = registry.list();
    const strategies: StrategyListItem[] = [];
    for (const id of ids) {
      const s = registry.resolve(id);
      if (!s) continue;
      strategies.push({
        id: s.id,
        name: s.name,
        family: s.family,
        description: s.description ?? null,
        type: "BASE",
        requiredHistory: s.requiredHistory,
        supportedTimeframes: s.supportedTimeframes ? [...s.supportedTimeframes] : null,
        parameterSpec: mapParamSpec(s.parameterSpec),
      });
    }
    return { strategies, total: strategies.length };
  }

  public get(id: string): StrategyDetail | null {
    const registry = getStrategyRegistry();
    const s = registry.resolve(id);
    if (!s) return null;
    return {
      id: s.id,
      name: s.name,
      family: s.family,
      description: s.description ?? null,
      type: "BASE",
      requiredHistory: s.requiredHistory,
      supportedTimeframes: s.supportedTimeframes ? [...s.supportedTimeframes] : null,
      parameterSpec: mapParamSpec(s.parameterSpec),
      defaultParameters: s.defaultParameters(),
      parameterValidation: {
        hasCrossFieldRules: hasCrossFieldRules(s),
      },
    };
  }
}
