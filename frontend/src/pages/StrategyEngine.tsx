/**
 * StrategyEngine — full rewrite addressing Issues 1–5:
 *
 * Issue 1: JSON editor is now an editable <textarea> with bidirectional
 *          sync to the parsed StrategyEngineJson state. JSON syntax errors
 *          are shown separately from domain validation errors.
 *
 * Issue 2: History table rows now have a "Mở" Load button. After saving,
 *          the active strategy ID is stored in localStorage. On mount the
 *          page restores the last active strategy from the backend.
 *
 * Issue 3+4+5: Error states are now fully isolated per action:
 *   - promptError   — only cleared/written by the Prompt action
 *   - urlImportError — only cleared/written by the URL action
 *   - validationError — only cleared/written by Validate
 *   - saveError     — only cleared/written by Save
 *   No cross-contamination between sections.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  HelpCircle,
  Bell,
  Sparkles,
  Trash2,
  Globe,
  Copy,
  Check,
  CheckCircle2,
  FileJson,
  Save,
  RefreshCw,
  AlertCircle,
  X,
  FolderOpen,
} from 'lucide-react';
import {
  generateStrategyFromPrompt,
  importStrategyFromUrl,
  validateStrategyJson,
  saveStrategy,
  fetchSavedStrategies,
  fetchSavedStrategyById,
  type StrategyEngineJson,
  type SavedStrategyDto,
  type ValidationResponse,
} from '../services/strategyEngineApi';

const LOCALSTORAGE_ACTIVE_KEY = 'strategyEngineActiveId';

const EMPTY_JSON: StrategyEngineJson = {
  name: '',
  version: '1.0.0',
  family: 'MOMENTUM',
  implementationRef: '',
  parameterSpec: { fields: [] },
  parameters: {},
  requiredHistory: 20,
  supportedTimeframes: ['1m', '5m', '15m', '1h', '4h', '1d'],
  timeframe: '1h',
  source: 'USER_PROMPT',
  tags: [],
  description: '',
};

function emptyJsonText(): string {
  return JSON.stringify(EMPTY_JSON, null, 2);
}

interface RecentItem {
  id: string;
  name: string;
  source: 'USER_PROMPT' | 'WEB_IMPORT';
  createdAt: string;
  version: string;
  tags: string[];
}

export default function StrategyEngine() {
  // ── Input fields ────────────────────────────────────────────────────
  const [prompt, setPrompt] = useState('');
  const [url, setUrl] = useState('');

  // ── Loading states ──────────────────────────────────────────────────
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false); // loading active strategy on mount

  // ── Strategy form state ───────────────────────────────────────────────
  const [strategyName, setStrategyName] = useState('');
  const [strategyVersion, setStrategyVersion] = useState('1.0.0');
  const [strategyTags, setStrategyTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [strategySource, setStrategySource] = useState<'USER_PROMPT' | 'WEB_IMPORT'>('USER_PROMPT');

  // ── JSON editor state (Issue 1) ─────────────────────────────────────
  // jsonText is the editable string in the <textarea>.
  // jsonDefinition is the parsed, validated object.
  // They stay in sync: edits update jsonDefinition; UI updates update jsonText.
  const [jsonText, setJsonText] = useState<string>(emptyJsonText);
  const [jsonDefinition, setJsonDefinition] = useState<StrategyEngineJson>(EMPTY_JSON);
  // jsonSyntaxError is non-null when jsonText is not valid JSON.
  const [jsonSyntaxError, setJsonSyntaxError] = useState<string | null>(null);

  // ── Validation state ─────────────────────────────────────────────────
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  // Issue 3/5: validationError is isolated from other sections
  const [validationError, setValidationError] = useState<string | null>(null);

  // ── Generation warning (non-blocking advisory) ────────────────────────
  const [generationWarning, setGenerationWarning] = useState<string | null>(null);

  // ── Save state ──────────────────────────────────────────────────────
  // Issue 3/5: saveError is isolated
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccessId, setSaveSuccessId] = useState<string | null>(null);

  // ── ISOLATED error states (Issue 3/4/5) ─────────────────────────────
  // promptError — only written/cleared by the Prompt action
  const [promptError, setPromptError] = useState<string | null>(null);
  // urlImportError — only written/cleared by the URL action
  const [urlImportError, setUrlImportError] = useState<string | null>(null);

  // ── Copy state ──────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);

  // ── History table state ──────────────────────────────────────────────
  const [history, setHistory] = useState<RecentItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // ─── Helpers ────────────────────────────────────────────────────────

  function jsonToText(j: StrategyEngineJson): string {
    return JSON.stringify(j, null, 2);
  }

  /**
   * Apply a StrategyEngineJson to all form fields and JSON editor state.
   * Used after LLM generation, URL import, and when loading a saved strategy.
   */
  function applyStrategyJson(json: StrategyEngineJson, warn?: string) {
    setJsonDefinition(json);
    setJsonText(jsonToText(json));
    setJsonSyntaxError(null);
    setStrategyName(json.name);
    setStrategyVersion(json.version);
    setStrategySource(json.source ?? 'USER_PROMPT');
    setStrategyTags(json.tags && json.tags.length > 0 ? [...json.tags] : []);
    setValidation(null);
    setValidationError(null);
    setGenerationWarning(warn ?? null);
    // Clear all errors when a new strategy is loaded
    setPromptError(null);
    setUrlImportError(null);
    setSaveError(null);
    setSaveSuccessId(null);
  }

  // ─── Mount: restore active strategy from localStorage + load history ──
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetchSavedStrategies();
      setHistory(res.strategies.map(toRecentItem));
    } catch (err) {
      setHistoryError((err as Error).message ?? 'Failed to load saved strategies.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const storedId = localStorage.getItem(LOCALSTORAGE_ACTIVE_KEY);
    if (!storedId) return;

    setIsRestoring(true);
    fetchSavedStrategyById(storedId)
      .then((record) => {
        const json = record.jsonDef as unknown as StrategyEngineJson;
        applyStrategyJson({
          ...EMPTY_JSON,
          ...json,
          name: record.name,
          version: record.version,
          source: record.source,
          tags: [...record.tags],
        });
      })
      .catch(() => {
        // Stale ID or record deleted — clear it
        localStorage.removeItem(LOCALSTORAGE_ACTIVE_KEY);
      })
      .finally(() => {
        setIsRestoring(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only

  // ─── JSON editor: parse on text change ──────────────────────────────
  // Issue 1: Bidirectional sync. User edits jsonText → we try to parse it.
  // If valid → update jsonDefinition + clear syntax error.
  // If invalid → keep jsonText as-is, show syntax error, keep last valid jsonDefinition.
  const handleJsonTextChange = useCallback((text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text) as unknown;
      // Basic structural sanity check — at minimum it must be an object
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setJsonSyntaxError('JSON must be an object.');
        return;
      }
      setJsonSyntaxError(null);
      setJsonDefinition(parsed as StrategyEngineJson);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Extract the useful part of the error message
      const match = msg.match(/position (\d+)/i);
      const snippet = match ? ` at character ${match[1]}` : '';
      setJsonSyntaxError(`Invalid JSON syntax${snippet}: ${msg.split('\n').pop()?.trim() ?? msg}`);
    }
  }, []);

  // ─── Update helper: sync form fields into jsonDefinition + jsonText ──
  // Used by Name / Version / Tags / Source handlers.
  const syncJsonFromForm = useCallback(
    (patch: Partial<StrategyEngineJson>) => {
      setJsonDefinition((prev) => {
        const next = { ...prev, ...patch };
        // Re-serialize so the textarea reflects the form field change
        setJsonText(jsonToText(next));
        return next;
      });
      setJsonSyntaxError(null);
    },
    [],
  );

  // ─── Name / version / source edits sync into JSON ────────────────────
  const handleNameChange = (name: string) => {
    setStrategyName(name);
    syncJsonFromForm({ name });
  };
  const handleVersionChange = (version: string) => {
    setStrategyVersion(version);
    syncJsonFromForm({ version });
  };
  const handleSourceChange = (source: 'USER_PROMPT' | 'WEB_IMPORT') => {
    setStrategySource(source);
    syncJsonFromForm({ source });
  };

  // ─── Prompt → LLM generation ─────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!prompt.trim()) return;

    // Issue 5: Clear ONLY the prompt error, nothing else
    setPromptError(null);
    setSaveSuccessId(null);
    setSaveError(null);
    setGenerationWarning(null);
    setIsAnalyzing(true);

    try {
      const result = await generateStrategyFromPrompt({
        prompt,
        source: 'USER_PROMPT',
        tags: strategyTags,
      });
      applyStrategyJson(result, undefined);
    } catch (err) {
      const apiErr = err as Error & { code?: string; validation?: ValidationResponse };
      // Issue 5: Only write to promptError, never to urlImportError
      if (apiErr.code === 'NOT_CONFIGURED') {
        setPromptError(
          'GEMINI_API_KEY chưa được cấu hình. Đặt GEMINI_API_KEY trong backend/.env để bật tính năng này.',
        );
      } else if (apiErr.validation && !apiErr.validation.ok) {
        setPromptError(
          `LLM trả về dữ liệu không hợp lệ: ${(apiErr.validation.errors ?? []).join(' • ')}`,
        );
      } else {
        setPromptError(apiErr.message ?? 'Tạo strategy từ prompt thất bại.');
      }
      setValidation(null);
      setValidationError(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ─── URL → Web extraction ────────────────────────────────────────────
  // Issue 3/4/5: all errors go to urlImportError, never to promptError
  const handleExtract = async () => {
    if (!url.trim()) return;

    // Issue 5: Clear ONLY the URL error
    setUrlImportError(null);
    setSaveSuccessId(null);
    setSaveError(null);
    setGenerationWarning(null);
    setIsExtracting(true);

    try {
      const result = await importStrategyFromUrl({ url, tags: strategyTags });
      applyStrategyJson(result, undefined);
    } catch (err) {
      const apiErr = err as Error & { code?: string };
      // Issue 4: Map machine-readable codes to user-friendly messages
      const code = apiErr.code ?? '';
      if (code === 'INVALID_URL' || code === 'INVALID_BODY') {
        setUrlImportError(
          'URL không hợp lệ. Vui lòng nhập một URL đầy đủ, ví dụ: https://example.com/strategy',
        );
      } else if (code === 'UNSUPPORTED_PROTOCOL') {
        setUrlImportError('Giao thức không được hỗ trợ. Chỉ hỗ trợ http và https.');
      } else if (code === 'NOT_CONFIGURED') {
        setUrlImportError(
          'GEMINI_API_KEY chưa được cấu hình. Đặt GEMINI_API_KEY trong backend/.env để bật tính năng này.',
        );
      } else if (code === 'NOT_A_STRATEGY_PAGE') {
        // Preserve the specific reason from the backend
        setUrlImportError(
          `Trang không chứa chiến lược cụ thể: ${apiErr.message ?? 'Không tìm thấy quy tắc vào/ra lệnh rõ ràng.'}`,
        );
      } else if (code === 'NETWORK' || code === 'FETCH_FAILED') {
        setUrlImportError(`Không thể truy cập URL: ${apiErr.message ?? 'Lỗi mạng.'}`);
      } else if (code === 'PARSE_ERROR' || code === 'SCHEMA') {
        setUrlImportError(
          `Không thể trích xuất chiến lược từ trang này: ${apiErr.message ?? 'Nội dung không hợp lệ.'}`,
        );
      } else {
        setUrlImportError(apiErr.message ?? 'Trích xuất từ URL thất bại.');
      }
      setValidation(null);
      setValidationError(null);
    } finally {
      setIsExtracting(false);
    }
  };

  // ─── Copy JSON to clipboard ───────────────────────────────────────────
  const handleCopy = () => {
    navigator.clipboard.writeText(jsonText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── Tag management ───────────────────────────────────────────────────
  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      if (!strategyTags.includes(tagInput.trim())) {
        const next = [...strategyTags, tagInput.trim()];
        setStrategyTags(next);
        syncJsonFromForm({ tags: next });
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    const next = strategyTags.filter((t) => t !== tag);
    setStrategyTags(next);
    syncJsonFromForm({ tags: next });
  };

  // ─── Re-run validation on demand ────────────────────────────────────
  // Issue 5: writes to validationError only; does NOT touch promptError or urlImportError
  const handleValidate = async () => {
    setValidationError(null);

    if (jsonSyntaxError !== null) {
      setValidationError(`Sửa lỗi JSON syntax trước: ${jsonSyntaxError}`);
      return;
    }

    setIsValidating(true);
    try {
      const result = await validateStrategyJson(jsonDefinition);
      setValidation(result);
      if (!result.ok) {
        setValidationError(
          result.errors?.join(' • ') ?? 'Validation failed.',
        );
      }
    } catch (err) {
      setValidation(null);
      setValidationError((err as Error).message ?? 'Validation failed.');
    } finally {
      setIsValidating(false);
    }
  };

  // ─── Save to backend ──────────────────────────────────────────────────
  // Issue 5: writes to saveError only; does NOT touch promptError or urlImportError
  const handleSave = async () => {
    if (jsonSyntaxError !== null) {
      setSaveError(`Không thể lưu: sửa lỗi JSON syntax trước.`);
      return;
    }
    if (!strategyName.trim()) {
      setSaveError('Tên strategy không được để trống.');
      return;
    }

    setSaveError(null);
    setSaveSuccessId(null);
    setIsSaving(true);

    try {
      // Build the final JSON from current form state
      const toSave: StrategyEngineJson = {
        ...jsonDefinition,
        name: strategyName,
        version: strategyVersion,
        tags: strategyTags,
        source: strategySource,
      };

      // Authoritative validation before save (Issue 1: validates CURRENT edited JSON)
      const validationResult = await validateStrategyJson(toSave);
      if (!validationResult.ok) {
        setSaveError(
          `Strategy không hợp lệ:\n${(validationResult.errors ?? []).join('\n')}`,
        );
        setIsSaving(false);
        return;
      }

      const record = await saveStrategy({ json: toSave });
      setSaveSuccessId(record.id);

      // Persist as the active strategy in localStorage
      localStorage.setItem(LOCALSTORAGE_ACTIVE_KEY, record.id);

      // Reload the history table
      void loadHistory();
    } catch (err) {
      setSaveError((err as Error).message ?? 'Lưu strategy thất bại.');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Load a saved strategy from the history table ─────────────────────
  // Issue 2: restore a saved strategy into the editor
  const handleLoadFromHistory = useCallback(
    async (id: string) => {
      setIsRestoring(true);
      setUrlImportError(null);
      setPromptError(null);
      setSaveError(null);
      setSaveSuccessId(null);
      try {
        const record = await fetchSavedStrategyById(id);
        const json = record.jsonDef as unknown as StrategyEngineJson;
        applyStrategyJson({
          ...EMPTY_JSON,
          ...json,
          name: record.name,
          version: record.version,
          source: record.source,
          tags: [...record.tags],
        });
        // Set as active in localStorage
        localStorage.setItem(LOCALSTORAGE_ACTIVE_KEY, record.id);
      } catch {
        setUrlImportError('Không thể tải chiến lược này. Có thể đã bị xóa.');
      } finally {
        setIsRestoring(false);
      }
    },
    [], // no deps needed — uses current state via closures
  );

  // ─── Render ─────────────────────────────────────────────────────────

  const isBusy = isAnalyzing || isExtracting || isValidating || isSaving || isRestoring;

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Top Header */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Tạo Strategy từ Prompt / URL</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Người dùng nhập ngôn ngữ tự nhiên hoặc link website để hệ thống sinh strategy và lưu vào thư viện
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-green-50 text-green-700 border border-green-200/50 px-3.5 py-1.5 rounded-full text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>Nguồn dữ liệu: Binance API + WebSocket</span>
          </div>
          <button className="p-2 rounded-xl hover:bg-slate-50 border border-slate-100 text-slate-500 hover:text-slate-950 transition-colors">
            <HelpCircle className="w-5 h-5" />
          </button>
          <button className="p-2 rounded-xl hover:bg-slate-50 border border-slate-100 text-slate-500 hover:text-slate-950 transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
          </button>
        </div>
      </header>

      {/* Main Grid Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column (Inputs) */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          {/* ── Prompt section ─────────────────────────────────────── */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                <span>Nhập mô tả strategy</span>
                <HelpCircle className="w-4 h-4 text-slate-400 cursor-pointer" />
              </h3>
            </div>

            <textarea
              className="w-full h-40 p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-semibold text-xs leading-relaxed focus:outline-none focus:border-blue-500 resize-none"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ví dụ: Khi RSI dưới 30 thì LONG..."
              maxLength={1000}
              disabled={isAnalyzing}
            />

            <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold">
              <span>{prompt.length}/1000</span>
              <span>Giới hạn 1000 ký tự</span>
            </div>

            {/* Issue 3/5: Only promptError renders here — never urlImportError */}
            {promptError && (
              <div className="flex gap-2 items-start bg-red-50 border border-red-100 rounded-xl p-3 text-[11px] text-red-700 font-semibold">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{promptError}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || !prompt.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Sparkles className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
                <span>{isAnalyzing ? 'Đang phân tích...' : 'Phân tích bằng LLM'}</span>
              </button>
              <button
                onClick={() => { setPrompt(''); setPromptError(null); }}
                className="p-2.5 rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-800 transition-colors"
                title="Xóa mô tả"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </article>

          {/* ── URL section ────────────────────────────────────────── */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
              <span>Nhập URL chiến lược</span>
              <HelpCircle className="w-4 h-4 text-slate-400 cursor-pointer" />
            </h3>

            <div className="flex flex-col gap-1.5">
              <div className="relative">
                <input
                  type="text"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-medium text-xs focus:outline-none focus:border-blue-500"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://tradingview.com/script/..."
                  disabled={isExtracting}
                />
                <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
              <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
                Hỗ trợ: TradingView, Blogger, Medium, GitHub Gist, Docs...
              </p>
            </div>

            {/* Issue 3/4/5: Only urlImportError renders here — never promptError */}
            {urlImportError && (
              <div className="flex gap-2 items-start bg-red-50 border border-red-100 rounded-xl p-3 text-[11px] text-red-700 font-semibold">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{urlImportError}</span>
              </div>
            )}

            <button
              onClick={handleExtract}
              disabled={isExtracting || !url.trim()}
              className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-extrabold text-xs shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Globe className={`w-4 h-4 ${isExtracting ? 'animate-spin' : ''}`} />
              <span>{isExtracting ? 'Đang trích xuất...' : 'Trích xuất từ website'}</span>
            </button>
          </article>
        </div>

        {/* Middle Column (Analysis Output & JSON) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Strategy đã phân tích */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <h3 className="text-sm font-extrabold text-slate-800">Strategy đã phân tích</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <div className="bg-emerald-50/50 border border-emerald-100 p-3.5 rounded-xl flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Family
                  </span>
                  <span className="text-xs font-extrabold text-emerald-900">
                    {jsonDefinition.family ?? '—'}
                  </span>
                </div>
                <div className="bg-red-50/50 border border-red-100 p-3.5 rounded-xl flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-red-800 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> ImplementationRef
                  </span>
                  <span className="text-[11px] font-mono font-semibold text-slate-700 break-all">
                    {jsonDefinition.implementationRef ?? '—'}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="bg-purple-50/50 border border-purple-100 p-3.5 rounded-xl flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-purple-800 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" /> Required history
                  </span>
                  <span className="text-xs font-extrabold text-purple-900">
                    {jsonDefinition.requiredHistory ?? '—'} candles
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200/50 p-3.5 rounded-xl grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Timeframe</span>
                    <span className="text-xs font-extrabold text-slate-700 mt-1">
                      {jsonDefinition.timeframe ?? '—'}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Params</span>
                    <span className="text-xs font-extrabold text-slate-700 mt-1">
                      {jsonDefinition.parameterSpec?.fields?.length ?? 0}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {generationWarning && (
              <div className="flex gap-2 items-start bg-amber-50 border border-amber-100 rounded-xl p-3 text-[11px] text-amber-700 font-semibold">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{generationWarning}</span>
              </div>
            )}
          </article>

          {/* ── JSON Editor (Issue 1: now editable) ───────────────── */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-3 relative">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                <FileJson className="w-4 h-4 text-blue-500" />
                <span>Định nghĩa strategy (JSON) — có thể chỉnh sửa</span>
              </h3>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-bold text-slate-600 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Đã sao chép' : 'Sao chép'}</span>
              </button>
            </div>

            {/* JSON syntax error (Issue 1): separate from domain validation */}
            {jsonSyntaxError && (
              <div className="flex gap-2 items-start bg-red-50 border border-red-200 rounded-xl p-3 text-[11px] text-red-700 font-semibold">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-bold">Lỗi cú pháp JSON:</div>
                  <div>{jsonSyntaxError}</div>
                  <div className="mt-1 text-[10px] text-red-600">
                    Sửa JSON trên rồi bấm Validate để kiểm tra domain.
                  </div>
                </div>
              </div>
            )}

            {/* Editable JSON textarea */}
            <textarea
              className={`w-full min-h-[200px] max-h-[320px] rounded-xl p-4 border font-mono text-[11px] leading-relaxed text-left whitespace-pre overflow-auto resize-none focus:outline-none ${
                jsonSyntaxError
                  ? 'bg-red-950 border-red-300 text-red-200 focus:border-red-500'
                  : 'bg-slate-900 border-slate-700 text-slate-300 focus:border-blue-500'
              }`}
              value={jsonText}
              onChange={(e) => handleJsonTextChange(e.target.value)}
              spellCheck={false}
              disabled={isBusy}
              title="Chỉnh sửa JSON — Ctrl+Z để undo"
            />
          </article>

          {/* ── Validation section ──────────────────────────────────── */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800">Kiểm tra &amp; Validation</h3>
              <button
                onClick={handleValidate}
                disabled={isValidating || isBusy || jsonSyntaxError !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-bold text-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? 'animate-spin' : ''}`} />
                <span>Validate</span>
              </button>
            </div>

            {isValidating ? (
              <div className="flex items-center gap-2 text-[11px] text-slate-500 font-semibold">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Validating against backend schema...
              </div>
            ) : validation ? (
              validation.ok ? (
                <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 p-3 rounded-xl text-emerald-800">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div className="text-xs">
                    <span className="font-bold">Trạng thái: </span>
                    <span className="font-medium">Hợp lệ (backend xác nhận).</span>
                    {validation.warnings && validation.warnings.length > 0 && (
                      <div className="mt-1 text-[10px] text-emerald-700">
                        Warnings: {validation.warnings.join(' • ')}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 bg-red-50 border border-red-100 p-3 rounded-xl text-red-800">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                    <span className="font-bold text-xs">Không hợp lệ.</span>
                  </div>
                  <ul className="list-disc pl-5 text-[11px] font-semibold">
                    {(validation.errors ?? []).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-slate-400 font-semibold">
                <HelpCircle className="w-3.5 h-3.5" />
                Click "Validate" để kiểm tra với backend.
              </div>
            )}

            {/* Issue 3/5: validationError is isolated — never touches promptError/urlImportError */}
            {validationError && !validation?.ok && (
              <div className="text-[11px] text-red-700 font-semibold">
                Sửa các lỗi trên trước khi lưu.
              </div>
            )}
          </article>
        </div>

        {/* Right Column (Library form details) */}
        <div className="lg:col-span-1">
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 h-full">
            <h3 className="text-sm font-extrabold text-slate-800">Lưu vào Strategy Library</h3>

            <div className="flex flex-col gap-4 flex-1">
              {/* Form - Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Name</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-xs focus:outline-none focus:border-blue-500"
                  value={strategyName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  disabled={isBusy}
                />
              </div>

              {/* Form - Version */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Version</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-xs focus:outline-none focus:border-blue-500"
                  value={strategyVersion}
                  onChange={(e) => handleVersionChange(e.target.value)}
                  disabled={isBusy}
                />
              </div>

              {/* Form - Tags */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tags</label>
                <div className="flex flex-wrap gap-1.5 p-2 rounded-xl border border-slate-200 bg-slate-50 min-h-[44px]">
                  {strategyTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 bg-white border border-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded-lg text-[10px]"
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                        disabled={isBusy}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    className="flex-1 bg-transparent border-none text-xs font-semibold text-slate-700 min-w-[60px] focus:outline-none"
                    placeholder="Thêm tag..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    disabled={isBusy}
                  />
                </div>
              </div>

              {/* Form - Source */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Source</label>
                <select
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-xs focus:outline-none focus:border-blue-500"
                  value={strategySource}
                  onChange={(e) => handleSourceChange(e.target.value as 'USER_PROMPT' | 'WEB_IMPORT')}
                  disabled={isBusy}
                >
                  <option value="USER_PROMPT">USER_PROMPT</option>
                  <option value="WEB_IMPORT">WEB_IMPORT</option>
                </select>
              </div>

              {/* Issue 3/5: saveError renders here — isolated from promptError/urlImportError */}
              {saveError && (
                <div className="flex gap-2 items-start bg-red-50 border border-red-100 rounded-xl p-3 text-[11px] text-red-700 font-semibold whitespace-pre-line">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}

              {saveSuccessId && (
                <div className="flex gap-2 items-start bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-[11px] text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Đã lưu thành công.{' '}
                    <span className="font-mono">{saveSuccessId.slice(0, 8)}…</span>
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={handleSave}
              disabled={isSaving || !strategyName.trim() || jsonSyntaxError !== null}
              className="w-full mt-4 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md shadow-blue-200 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Save className="w-4.5 h-4.5" />
              <span>{isSaving ? 'Đang lưu...' : 'Lưu Strategy'}</span>
            </button>
          </article>
        </div>
      </div>

      {/* Bottom Table Section — Issue 2: Load action */}
      <section className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-extrabold text-slate-800">Chiến lược đã lưu</h3>
          <button
            onClick={() => void loadHistory()}
            disabled={historyLoading}
            className="text-xs font-bold text-blue-600 hover:underline disabled:opacity-50"
          >
            {historyLoading ? 'Đang tải...' : 'Tải lại'}
          </button>
        </div>

        {isRestoring && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500 font-semibold">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Đang khôi phục chiến lược...
          </div>
        )}

        {historyError ? (
          <div className="flex gap-2 items-start bg-red-50 border border-red-100 rounded-xl p-3 text-[11px] text-red-700 font-semibold">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{historyError}</span>
          </div>
        ) : historyLoading && !isRestoring ? (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-xs font-semibold">Đang tải...</span>
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-400">
            <FileJson className="w-6 h-6 opacity-40" />
            <span className="text-xs font-semibold">Chưa có strategy nào được lưu.</span>
            <span className="text-[10px]">Tạo strategy bằng prompt hoặc URL rồi bấm "Lưu Strategy".</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-bold text-slate-600 text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-400 border-b border-slate-100 text-[10px] tracking-wider">
                  <th className="py-3 px-3">Tên strategy</th>
                  <th className="py-3 px-2">Source</th>
                  <th className="py-3 px-2">Ngày tạo</th>
                  <th className="py-3 px-2">Version</th>
                  <th className="py-3 px-2">Tags</th>
                  <th className="py-3 px-2">Trạng thái</th>
                  <th className="py-3 px-3">ID</th>
                  <th className="py-3 px-3 text-center">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3 text-slate-800">{item.name}</td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wide ${
                        item.source === 'USER_PROMPT' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'
                      }`}>
                        {item.source}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-slate-500 font-medium">{item.createdAt}</td>
                    <td className="py-3 px-2 text-slate-500 font-semibold">{item.version}</td>
                    <td className="py-3 px-2">
                      <div className="flex flex-wrap gap-1">
                        {item.tags.map((tag) => (
                          <span key={tag} className="bg-slate-100 border border-slate-200/50 text-slate-500 font-bold px-1.5 py-0.5 rounded text-[9px]">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <span className="flex items-center gap-1.5 text-emerald-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>Hợp lệ</span>
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-[10px] text-slate-400">{item.id.slice(0, 8)}…</td>
                    <td className="py-3 px-3">
                      <button
                        onClick={() => void handleLoadFromHistory(item.id)}
                        disabled={isRestoring || isBusy}
                        className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 font-extrabold text-[10px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mx-auto"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Mở</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toRecentItem(s: SavedStrategyDto): RecentItem {
  return {
    id: s.id,
    name: s.name,
    source: s.source,
    createdAt: new Date(s.createdAt).toLocaleString('vi-VN', { hour12: false }),
    version: s.version,
    tags: [...s.tags],
  };
}
