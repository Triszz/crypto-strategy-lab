/**
 * StrategyDetail — shows a strategy's full information and renders
 * a dynamic parameter configuration form.
 *
 * - Fetches strategy detail from GET /api/strategies/:id.
 * - Renders parameter fields dynamically based on parameterSpec.fields.
 * - Timeframe selector uses supportedTimeframes from the API.
 * - Prepares a StrategyConfig model for future Search API wiring.
 *
 * No strategy-specific hard-coding.
 */
import { useState, useCallback } from "react";
import {
  ArrowLeft,
  Clock,
  BarChart2,
  Settings2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";
import type {
  StrategyDetail as StrategyDetailType,
  ParameterField,
} from "../../services/strategyApi";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** A ready-to-send strategy configuration built from the form. */
export interface StrategyConfig {
  strategyId: string;
  timeframe: string;
  parameters: Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Parameter Field Renderers ─────────────────────────────────────────────────

interface FieldProps {
  field: ParameterField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  error?: string;
}

function IntegerField({ field, value, onChange, error }: FieldProps) {
  const num = typeof value === "number" ? value : Number(field.defaultValue ?? 0);
  const min = field.min ?? 0;
  const max = field.max ?? 999_999;
  const safe = clamp(num, min, max);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{field.key}</label>
        {error && <span className="text-[9px] text-red-500 font-semibold">{error}</span>}
      </div>
      <div className="relative">
        <input
          type="number"
          value={safe}
          min={min}
          max={max}
          step={1}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            onChange(field.key, isNaN(v) ? min : clamp(v, min, max));
          }}
          className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors"
        />
        {field.min !== undefined && field.max !== undefined && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-slate-300 font-semibold pointer-events-none">
            [{min}–{max}]
          </span>
        )}
      </div>
      {field.description && (
        <p className="text-[10px] text-slate-400 font-medium leading-relaxed">{field.description}</p>
      )}
    </div>
  );
}

function DecimalField({ field, value, onChange, error }: FieldProps) {
  const num = typeof value === "number" ? value : Number(field.defaultValue ?? 0);
  const min = field.min ?? 0;
  const max = field.max ?? 999_999;
  const safe = clamp(num, min, max);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{field.key}</label>
        {error && <span className="text-[9px] text-red-500 font-semibold">{error}</span>}
      </div>
      <div className="relative">
        <input
          type="number"
          value={safe}
          min={min}
          max={max}
          step="0.01"
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange(field.key, isNaN(v) ? min : clamp(v, min, max));
          }}
          className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors"
        />
        {field.min !== undefined && field.max !== undefined && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-slate-300 font-semibold pointer-events-none">
            [{min}–{max}]
          </span>
        )}
      </div>
      {field.description && (
        <p className="text-[10px] text-slate-400 font-medium leading-relaxed">{field.description}</p>
      )}
    </div>
  );
}

function EnumField({ field, value, onChange, error }: FieldProps) {
  const vals: ReadonlyArray<string> = field.values ?? [];
  const current = vals.includes(String(value)) ? String(value) : String(field.defaultValue ?? vals[0] ?? "");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{field.key}</label>
        {error && <span className="text-[9px] text-red-500 font-semibold">{error}</span>}
      </div>
      <select
        value={current}
        onChange={(e) => onChange(field.key, e.target.value)}
        className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors cursor-pointer"
      >
        {vals.map((v: string) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      {field.description && (
        <p className="text-[10px] text-slate-400 font-medium leading-relaxed">{field.description}</p>
      )}
    </div>
  );
}

// ─── Cross-field Validation Banner ─────────────────────────────────────────────

function CrossFieldNote({ strategyId }: { strategyId: string }) {
  const isMA = strategyId === "strategy.ma";
  const isRSI = strategyId === "strategy.rsi";

  if (!isMA && !isRSI) return null;

  return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex gap-2.5 items-start">
      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
      <div className="text-[11px] text-amber-700 font-semibold leading-relaxed">
        {isMA && "Cross-field rule: fastPeriod must be strictly less than slowPeriod."}
        {isRSI && "Cross-field rule: buyThreshold must be strictly less than sellThreshold."}
      </div>
    </div>
  );
}

// ─── Validation ────────────────────────────────────────────────────────────────

type ValidationErrors = Record<string, string>;

function validateFields(fields: readonly ParameterField[], values: Record<string, unknown>): ValidationErrors {
  const errors: ValidationErrors = {};
  for (const field of fields) {
    const v = values[field.key];
    if (field.kind === "integer" || field.kind === "decimal") {
      const num = Number(v);
      const min = field.min ?? null;
      const max = field.max ?? null;
      if (isNaN(num)) {
        errors[field.key] = "Must be a number.";
      } else if (min !== null && num < min) {
        errors[field.key] = `Minimum is ${min}.`;
      } else if (max !== null && num > max) {
        errors[field.key] = `Maximum is ${max}.`;
      }
    }
  }
  return errors;
}

/** MA-specific cross-field validation. */
function validateCrossField(strategyId: string, values: Record<string, unknown>): string | null {
  if (strategyId === "strategy.ma") {
    const fast = Number(values["fastPeriod"] ?? 0);
    const slow = Number(values["slowPeriod"] ?? 0);
    if (fast >= slow) {
      return "fastPeriod must be strictly less than slowPeriod.";
    }
  }
  if (strategyId === "strategy.rsi") {
    const buy = Number(values["buyThreshold"] ?? 0);
    const sell = Number(values["sellThreshold"] ?? 0);
    if (buy >= sell) {
      return "buyThreshold must be strictly less than sellThreshold.";
    }
  }
  return null;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export interface StrategyDetailProps {
  strategy: StrategyDetailType;
  /** Called when the user clicks Back */
  onBack: () => void;
  /**
   * Called when the configuration is ready to be sent to Search.
   * Receives the full StrategyConfig model.
   */
  onConfigure?: (config: StrategyConfig) => void;
}

export function StrategyDetail({ strategy, onBack, onConfigure }: StrategyDetailProps) {
  const {
    id,
    name,
    family,
    description,
    requiredHistory,
    supportedTimeframes,
    parameterSpec,
    defaultParameters,
    parameterValidation,
  } = strategy;

  const fields = parameterSpec.fields;

  // Merge defaults into mutable state
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of fields) {
      init[f.key] = f.defaultValue ?? (f.kind === "integer" || f.kind === "decimal" ? 0 : "");
    }
    // Apply runtime defaults from API (may differ from ParamSpec defaults)
    for (const [k, v] of Object.entries(defaultParameters)) {
      init[k] = v;
    }
    return init;
  });

  const [fieldErrors, setFieldErrors] = useState<ValidationErrors>({});
  const [crossFieldError, setCrossFieldError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const handleChange = useCallback(
    (key: string, value: unknown) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      // Clear field error on change
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setCrossFieldError(null);
    },
    [],
  );

  const handleValidate = useCallback(() => {
    const fieldErrs = validateFields(fields, values);
    setFieldErrors(fieldErrs);
    const crossErr = validateCrossField(id, values);
    setCrossFieldError(crossErr);
    setTouched(true);
    return Object.keys(fieldErrs).length === 0 && crossErr === null;
  }, [fields, values, id]);

  const hasErrors = Object.keys(fieldErrors).length > 0 || crossFieldError !== null;

  const handleSubmit = useCallback(() => {
    const valid = handleValidate();
    if (!valid || !onConfigure) return;

    // Build the timeframe — use first supported or fallback
    const tf = supportedTimeframes?.[0] ?? "5m";

    onConfigure({
      strategyId: id,
      timeframe: tf,
      parameters: { ...values },
    });
  }, [handleValidate, onConfigure, id, values, supportedTimeframes]);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">

      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
              {family}
            </span>
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 border border-slate-200">
              {parameterValidation.hasCrossFieldRules ? "⚙ has rules" : "✓ no cross-rules"}
            </span>
          </div>
          <h2 className="text-base font-extrabold text-slate-900 leading-tight mt-1">{name}</h2>
        </div>
      </div>

      {/* Info strip */}
      <div className="flex items-center gap-4 bg-white border border-slate-100 rounded-2xl px-5 py-3 shadow-sm">
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500 font-semibold">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          {requiredHistory} candles warm-up
        </span>
        {supportedTimeframes && supportedTimeframes.length > 0 && (
          <>
            <span className="text-slate-200">·</span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500 font-semibold">
              <BarChart2 className="w-3.5 h-3.5 text-slate-400" />
              {supportedTimeframes.join(", ")}
            </span>
          </>
        )}
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500 font-semibold">
          <Settings2 className="w-3.5 h-3.5 text-slate-400" />
          {fields.length} param{fields.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Description */}
      {description && (
        <p className="text-[12px] text-slate-500 font-medium leading-relaxed bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
          {description}
        </p>
      )}

      {/* Parameter form */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 flex flex-col gap-5">

        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-extrabold text-slate-800">Parameters</h3>
        </div>

        <CrossFieldNote strategyId={id} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {fields.map((field) => {
            const error = fieldErrors[field.key];
            if (field.kind === "enum") {
              return (
                <EnumField
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  onChange={handleChange}
                  error={error}
                />
              );
            }
            if (field.kind === "integer") {
              return (
                <IntegerField
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  onChange={handleChange}
                  error={error}
                />
              );
            }
            return (
              <DecimalField
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={handleChange}
                error={error}
              />
            );
          })}
        </div>

        {/* Cross-field error */}
        {touched && crossFieldError && (
          <div className="flex gap-2 items-start text-red-500 text-[11px] font-semibold">
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {crossFieldError}
          </div>
        )}

        {/* Valid */}
        {touched && !hasErrors && (
          <div className="flex gap-2 items-center text-emerald-600 text-[11px] font-semibold">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Configuration is valid.
          </div>
        )}

        {/* Submit */}
        {onConfigure && (
          <button
            onClick={handleSubmit}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm transition-colors"
          >
            Run Discovery with this configuration
          </button>
        )}
      </div>

      {/* Info */}
      <div className="flex gap-2 items-start text-slate-400 text-[10px] font-medium">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        Backend validates all parameters before running discovery. This form is for configuration only.
      </div>

    </div>
  );
}
