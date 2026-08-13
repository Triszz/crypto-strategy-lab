

# Database Design — Crypto Strategy Lab

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DATABASE ERD (PostgreSQL)                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐         ┌──────────────────────┐
│ market_data_providers│         │ news_providers       │
│──────────────────────│         │──────────────────────│
│ id (PK)              │         │ id (PK)              │
│ code (UNIQUE)        │         │ code (UNIQUE)        │
│ name                 │         │ name                 │
│ base_url             │         │ base_url             │
│ created_at           │         │ requires_api_key     │
└──────────┬───────────┘         │ created_at           │
           │                     └──────────┬───────────┘
           │ 1:N                            │ 1:N
           ▼                                ▼
┌──────────────────────┐         ┌──────────────────────┐
│ symbols              │         │ news                 │
│──────────────────────│         │──────────────────────│
│ id (PK)              │         │ id (PK)              │
│ provider_id (FK)     │         │ provider_id (FK)     │
│ symbol (UNIQUE)      │         │ external_id (UNIQUE) │
│ base_asset           │         │ title                │
│ quote_asset          │         │ summary              │
│ is_active            │         │ content              │
│ created_at           │         │ url (UNIQUE)         │
└──────────┬───────────┘         │ source               │
           │                     │ author               │
           │ 1:N                 │ published_at         │
           ▼                     │ crawled_at           │
┌──────────────────────┐         └──────────┬───────────┘
│ candles              │                    │ 1:N
│──────────────────────│                    │
│ id (PK)              │                    ▼
│ symbol_id (FK)       │         ┌──────────────────────┐
│ timeframe            │         │ news_coins           │
│ open_time            │         │──────────────────────│
│ close_time           │         │ news_id (FK,PK)      │
│ open / high / low    │         │ symbol_id (FK,PK)    │
│ close                │         └──────────────────────┘
│ volume               │
│ quote_volume         │         ┌──────────────────────┐
│ trades               │         │ sentiment_providers  │
│ created_at           │         │──────────────────────│
│ UNIQUE(symbol_id,    │         │ id (PK)              │
│   timeframe,open_time)         │ code (UNIQUE)        │
└──────────────────────┘         │ name                 │
                                 │ model_version        │
                                 │ created_at           │
                                 └──────────┬───────────┘
                                            │ 1:N
                                            ▼
┌──────────────────────┐         ┌──────────────────────┐
│ indicator_types      │         │ sentiments           │
│──────────────────────│         │──────────────────────│
│ id (PK)              │         │ id (PK)              │
│ code (UNIQUE)        │         │ news_id (FK)         │
│ name                 │         │ provider_id (FK)     │
│ category             │         │ classification       │
│ created_at           │         │ score (-1..1)        │
└──────────┬───────────┘         │ confidence           │
           │ 1:N                 │ analyzed_at          │
           ▼                     │ UNIQUE(news_id,      │
┌──────────────────────┐         │   provider_id)       │
│ strategy_definitions │         └──────────────────────┘
│──────────────────────│
│ id (PK)              │
│ type (BASE/COMPOSITE)│
│ family (TREND/       │
│  MOMENTUM/STRUCTURE) │
│ created_at           │
└──────────┬───────────┘
           │ 1:N
           ▼
┌──────────────────────┐
│ strategy_versions    │
│──────────────────────│
│ id (PK)              │
│ definition_id (FK)   │
│ version (semver)     │
│ name                 │
│ description          │
│ indicator_type_id(FK)│     ← NULL for COMPOSITE
│ implementation_ref   │     ← code registry key
│ parameters (JSONB)   │
│ is_active            │
│ created_at           │
│ UNIQUE(definition_id,│
│         version)     │
└──────────────────────┘

┌──────────────────────┐         ┌──────────────────────┐
│ composite_components │         │ strategy_registry    │
│──────────────────────│         │──────────────────────│
│ composite_version_id │         │ id (PK)              │
│  (FK)               │         │ definition_id (FK)   │
│ component_version_id │         │ registered_at        │
│  (FK)               │         │ is_enabled           │
│ weight (DECIMAL)     │         └──────────────────────┘
│ position (INT)       │
│ PK(composite_version,│
│   component_version)│
└──────────────────────┘

┌──────────────────────┐         ┌──────────────────────┐
│ search_algorithms   │         │ search_runs          │
│──────────────────────│         │──────────────────────│
│ id (PK)              │         │ id (PK)              │
│ code (UNIQUE)        │         │ algorithm_id (FK)    │
│ name                 │         │ symbol_id (FK)       │
│ implementation_ref   │         │ timeframe            │
│ created_at           │         │ max_candidates       │
└──────────┬───────────┘         │ from_time            │
           │ 1:N                 │ to_time              │
           ▼                     │ status (PENDING/     │
┌──────────────────────┐         │  RUNNING/DONE/STOPPED│
│ search_runs          │         │ started_at           │
│  (see right)         │         │ finished_at          │
└──────────────────────┘         │ created_by           │
                                 │ config (JSONB)       │
                                 └──────────┬───────────┘
                                            │ 1:N
                                            ▼
                                 ┌──────────────────────┐
                                 │ candidate_strategies │
                                 │──────────────────────│
                                 │ id (PK)              │
                                 │ search_run_id (FK)   │
                                 │ strategy_version_id  │
                                 │   (FK)               │
                                 │ parameters (JSONB)   │
                                 │ status (PENDING/     │
                                 │  QUEUED/RUNNING/     │
                                 │  DONE/FAILED)        │
                                 │ created_at           │
                                 └──────────┬───────────┘
                                            │ 1:1
                                            ▼
┌──────────────────────┐         ┌──────────────────────┐
│ experiments          │◀────────│ backtest_results     │
│──────────────────────│ 1:N     │──────────────────────│
│ id (PK)              │         │ id (PK)              │
│ candidate_id (FK)    │         │ experiment_id (FK)   │
│ name                 │         │ symbol_id (FK)       │
│ description          │         │ timeframe            │
│ symbol_id (FK)       │         │ from_time            │
│ timeframe            │         │ to_time              │
│ from_time            │         │ initial_capital      │
│ to_time              │         │ final_capital        │
│ initial_capital      │         │ total_return (%)     │
│ position_size        │         │ annual_return (%)    │
│ position_type (LONG/ │         │ win_rate (%)         │
│   SHORT)             │         │ max_drawdown (%)     │
│ status               │         │ num_trades           │
│ created_at           │         │ num_winning_trades   │
│ finished_at          │         │ num_losing_trades    │
│ error_message        │         │ sharpe_ratio         │
└──────────────────────┘         │ sortino_ratio        │
                                 │ overall_score        │
                                 │ equity_curve (JSONB) │
                                 │ created_at           │
                                 │ UNIQUE(experiment_id)│
                                 └──────────┬───────────┘
                                            │ 1:N
                                            ▼
┌──────────────────────┐         ┌──────────────────────┐
│ evaluation_metrics   │         │ trades               │
│──────────────────────│         │──────────────────────│
│ id (PK)              │         │ id (PK)              │
│ experiment_id (FK)   │         │ experiment_id (FK)   │
│ metric_code          │         │ symbol_id (FK)       │
│ metric_value         │         │ side (BUY/SELL)      │
│ metric_group         │         │ position (LONG/SHORT)│
│ created_at           │         │ entry_time           │
└──────────────────────┘         │ entry_price          │
                                 │ exit_time            │
                                 │ exit_price           │
                                 │ quantity             │
                                 │ profit_loss          │
                                 │ profit_loss_pct      │
                                 │ entry_reason         │
                                 │ exit_reason          │
                                 │ created_at           │
                                 └──────────────────────┘

┌──────────────────────┐         ┌──────────────────────┐
│ leaderboard_entries  │         │ ranking_history      │
│──────────────────────│         │──────────────────────│
│ id (PK)              │         │ id (PK)              │
│ strategy_version_id  │         │ strategy_version_id  │
│  (FK)               │         │   (FK)               │
│ symbol_id (FK)       │         │ rank                 │
│ timeframe            │         │ overall_score        │
│ total_return         │         │ snapshot_at          │
│ win_rate             │         │ dataset_label        │
│ max_drawdown         │         │ UNIQUE(strategy_     │
│ num_trades           │         │   version, snapshot) │
│ overall_score        │         └──────────────────────┘
│ rank                 │
│ last_evaluated_at    │
│ UNIQUE(strategy_     │
│   version_id,        │
│   symbol_id,         │
│   timeframe)         │
└──────────────────────┘

┌──────────────────────┐         ┌──────────────────────┐
│ queue_jobs           │         │ worker_statuses      │
│──────────────────────│         │──────────────────────│
│ id (PK)              │         │ id (PK)              │
│ job_id (UNIQUE)      │         │ worker_id (UNIQUE)   │
│ queue_name           │         │ host                 │
│ job_type             │         │ status (IDLE/BUSY/   │
│ payload (JSONB)      │         │  OFFLINE/ERROR)      │
│ status               │         │ current_job_id       │
│ attempts             │         │ last_heartbeat       │
│ max_attempts         │         │ total_processed      │
│ scheduled_at         │         │ total_failed         │
│ started_at           │         │ started_at           │
│ finished_at          │         │ created_at           │
│ error_message        │         └──────────────────────┘
│ created_at           │
└──────────────────────┘

┌──────────────────────┐         ┌──────────────────────┐
│ system_logs          │         │ settings             │
│──────────────────────│         │──────────────────────│
│ id (PK)              │         │ key (PK)             │
│ level (INFO/WARN/    │         │ value (JSONB)        │
│   ERROR/DEBUG)       │         │ description          │
│ source_module        │         │ updated_at           │
│ event_code           │         └──────────────────────┘
│ message              │
│ context (JSONB)      │
│ created_at           │
└──────────────────────┘
```

---

## SQL DDL (PostgreSQL)

```sql
-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE strategy_type        AS ENUM ('BASE','COMPOSITE');
CREATE TYPE strategy_family      AS ENUM ('TREND','MOMENTUM','STRUCTURE','VOLATILITY','SENTIMENT');
CREATE TYPE sentiment_class      AS ENUM ('POSITIVE','NEUTRAL','NEGATIVE');
CREATE TYPE position_type        AS ENUM ('LONG','SHORT');
CREATE TYPE trade_side           AS ENUM ('BUY','SELL');
CREATE TYPE experiment_status    AS ENUM ('PENDING','RUNNING','DONE','FAILED','STOPPED');
CREATE TYPE candidate_status     AS ENUM ('PENDING','QUEUED','RUNNING','DONE','FAILED','SKIPPED');
CREATE TYPE search_status        AS ENUM ('PENDING','RUNNING','DONE','STOPPED','FAILED');
CREATE TYPE worker_status        AS ENUM ('IDLE','BUSY','OFFLINE','ERROR');
CREATE TYPE log_level            AS ENUM ('DEBUG','INFO','WARN','ERROR');

-- ============================================================
-- 1. MARKET DATA
-- ============================================================
CREATE TABLE market_data_providers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          VARCHAR(50)  NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  base_url      TEXT         NOT NULL,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE symbols (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id   UUID NOT NULL REFERENCES market_data_providers(id) ON DELETE RESTRICT,
  symbol        VARCHAR(32)  NOT NULL,
  base_asset    VARCHAR(16)  NOT NULL,
  quote_asset   VARCHAR(16)  NOT NULL,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, symbol)
);

CREATE TABLE candles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol_id     UUID NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  timeframe     VARCHAR(8)   NOT NULL,
  open_time     BIGINT       NOT NULL,
  close_time    BIGINT       NOT NULL,
  open          NUMERIC(24,10) NOT NULL,
  high          NUMERIC(24,10) NOT NULL,
  low           NUMERIC(24,10) NOT NULL,
  close         NUMERIC(24,10) NOT NULL,
  volume        NUMERIC(32,10) NOT NULL,
  quote_volume  NUMERIC(32,10) NOT NULL,
  trades        INTEGER      NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT candles_unique UNIQUE (symbol_id, timeframe, open_time),
  CONSTRAINT candles_ohlc_check CHECK (low <= open AND low <= close AND high >= open AND high >= close),
  CONSTRAINT candles_tf_check CHECK (timeframe IN ('1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'))
);

CREATE INDEX idx_candles_symbol_timeframe_time ON candles (symbol_id, timeframe, open_time DESC);
CREATE INDEX idx_candles_open_time ON candles (open_time DESC);

-- ============================================================
-- 2. STRATEGY REGISTRY
-- ============================================================
CREATE TABLE indicator_types (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          VARCHAR(64)  NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  category      strategy_family NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE strategy_definitions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type          strategy_type NOT NULL,
  family        strategy_family NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE strategy_versions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  definition_id        UUID NOT NULL REFERENCES strategy_definitions(id) ON DELETE CASCADE,
  version              VARCHAR(32) NOT NULL,
  name                 VARCHAR(255) NOT NULL,
  description          TEXT,
  indicator_type_id    UUID REFERENCES indicator_types(id),
  implementation_ref   VARCHAR(255) NOT NULL,
  parameters           JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT strategy_versions_unique UNIQUE (definition_id, version)
);

CREATE TABLE composite_components (
  composite_version_id UUID NOT NULL REFERENCES strategy_versions(id) ON DELETE CASCADE,
  component_version_id UUID NOT NULL REFERENCES strategy_versions(id) ON DELETE RESTRICT,
  weight              NUMERIC(6,4) NOT NULL CHECK (weight >= 0 AND weight <= 1),
  position            SMALLINT NOT NULL,
  PRIMARY KEY (composite_version_id, component_version_id)
);

CREATE TABLE strategy_registry (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  definition_id   UUID NOT NULL REFERENCES strategy_definitions(id) ON DELETE CASCADE,
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (definition_id)
);

-- ============================================================
-- 3. SEARCH
-- ============================================================
CREATE TABLE search_algorithms (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code               VARCHAR(64) NOT NULL UNIQUE,
  name               VARCHAR(255) NOT NULL,
  implementation_ref VARCHAR(255) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE search_runs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  algorithm_id     UUID NOT NULL REFERENCES search_algorithms(id),
  symbol_id        UUID NOT NULL REFERENCES symbols(id),
  timeframe        VARCHAR(8) NOT NULL,
  max_candidates   INTEGER NOT NULL CHECK (max_candidates > 0),
  from_time        BIGINT,
  to_time          BIGINT,
  status           search_status NOT NULL DEFAULT 'PENDING',
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  created_by       VARCHAR(64),
  config           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE candidate_strategies (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  search_run_id         UUID NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  strategy_version_id   UUID NOT NULL REFERENCES strategy_versions(id),
  parameters            JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                candidate_status NOT NULL DEFAULT 'PENDING',
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. EXPERIMENT & BACKTEST
-- ============================================================
CREATE TABLE experiments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id      UUID NOT NULL REFERENCES candidate_strategies(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  symbol_id         UUID NOT NULL REFERENCES symbols(id),
  timeframe         VARCHAR(8) NOT NULL,
  from_time         BIGINT NOT NULL,
  to_time           BIGINT NOT NULL,
  initial_capital   NUMERIC(24,8) NOT NULL DEFAULT 10000,
  position_size     NUMERIC(24,8) NOT NULL,
  position_type     position_type NOT NULL DEFAULT 'LONG',
  status            experiment_status NOT NULL DEFAULT 'PENDING',
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ,
  CONSTRAINT experiments_timecheck CHECK (from_time < to_time)
);

CREATE TABLE backtest_results (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id       UUID NOT NULL UNIQUE REFERENCES experiments(id) ON DELETE CASCADE,
  symbol_id           UUID NOT NULL REFERENCES symbols(id),
  timeframe           VARCHAR(8) NOT NULL,
  from_time           BIGINT NOT NULL,
  to_time             BIGINT NOT NULL,
  initial_capital     NUMERIC(24,8) NOT NULL,
  final_capital       NUMERIC(24,8) NOT NULL,
  total_return        NUMERIC(10,4) NOT NULL,
  annual_return       NUMERIC(10,4),
  win_rate            NUMERIC(6,4) NOT NULL,
  max_drawdown        NUMERIC(10,4) NOT NULL,
  num_trades          INTEGER NOT NULL,
  num_winning_trades  INTEGER NOT NULL,
  num_losing_trades   INTEGER NOT NULL,
  sharpe_ratio        NUMERIC(10,4),
  sortino_ratio       NUMERIC(10,4),
  overall_score       NUMERIC(10,4) NOT NULL,
  equity_curve        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE evaluation_metrics (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id   UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  metric_code     VARCHAR(64) NOT NULL,
  metric_value    NUMERIC(20,8) NOT NULL,
  metric_group    VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (experiment_id, metric_code)
);

CREATE TABLE trades (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id   UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  symbol_id       UUID NOT NULL REFERENCES symbols(id),
  side            trade_side NOT NULL,
  position        position_type NOT NULL,
  entry_time      BIGINT NOT NULL,
  entry_price     NUMERIC(24,10) NOT NULL,
  exit_time       BIGINT,
  exit_price      NUMERIC(24,10),
  quantity        NUMERIC(24,10) NOT NULL,
  profit_loss     NUMERIC(24,8),
  profit_loss_pct NUMERIC(10,4),
  entry_reason    TEXT,
  exit_reason     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trades_experiment_entry ON trades (experiment_id, entry_time);

-- ============================================================
-- 5. LEADERBOARD
-- ============================================================
CREATE TABLE leaderboard_entries (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  strategy_version_id   UUID NOT NULL REFERENCES strategy_versions(id) ON DELETE CASCADE,
  symbol_id             UUID NOT NULL REFERENCES symbols(id),
  timeframe             VARCHAR(8) NOT NULL,
  total_return          NUMERIC(10,4) NOT NULL,
  win_rate              NUMERIC(6,4) NOT NULL,
  max_drawdown          NUMERIC(10,4) NOT NULL,
  num_trades            INTEGER NOT NULL,
  overall_score         NUMERIC(10,4) NOT NULL,
  rank                  INTEGER NOT NULL,
  last_evaluated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_version_id, symbol_id, timeframe)
);

CREATE INDEX idx_leaderboard_score_desc ON leaderboard_entries (overall_score DESC);
CREATE INDEX idx_leaderboard_symbol_tf_score ON leaderboard_entries (symbol_id, timeframe, overall_score DESC);

CREATE TABLE ranking_history (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  strategy_version_id   UUID NOT NULL REFERENCES strategy_versions(id) ON DELETE CASCADE,
  rank                  INTEGER NOT NULL,
  overall_score         NUMERIC(10,4) NOT NULL,
  snapshot_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dataset_label         VARCHAR(64),
  UNIQUE (strategy_version_id, snapshot_at)
);

CREATE INDEX idx_ranking_history_strategy_time ON ranking_history (strategy_version_id, snapshot_at DESC);

-- ============================================================
-- 6. NEWS & SENTIMENT
-- ============================================================
CREATE TABLE news_providers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            VARCHAR(64) NOT NULL UNIQUE,
  name            VARCHAR(255) NOT NULL,
  base_url        TEXT NOT NULL,
  requires_api_key BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE news (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id     UUID NOT NULL REFERENCES news_providers(id),
  external_id     VARCHAR(255) NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT,
  content         TEXT,
  url             TEXT NOT NULL,
  source          VARCHAR(255) NOT NULL,
  author          VARCHAR(255),
  published_at    TIMESTAMPTZ NOT NULL,
  crawled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, external_id)
);

CREATE INDEX idx_news_published_desc ON news (published_at DESC);
CREATE INDEX idx_news_provider_published ON news (provider_id, published_at DESC);

CREATE TABLE news_coins (
  news_id     UUID NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  symbol_id   UUID NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  PRIMARY KEY (news_id, symbol_id)
);

CREATE TABLE sentiment_providers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            VARCHAR(64) NOT NULL UNIQUE,
  name            VARCHAR(255) NOT NULL,
  model_version   VARCHAR(64) NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sentiments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  news_id         UUID NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  provider_id     UUID NOT NULL REFERENCES sentiment_providers(id),
  classification  sentiment_class NOT NULL,
  score           NUMERIC(4,3) NOT NULL CHECK (score >= -1 AND score <= 1),
  confidence      NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  analyzed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (news_id, provider_id)
);

CREATE INDEX idx_sentiments_news ON sentiments (news_id);
CREATE INDEX idx_sentiments_class ON sentiments (classification);

-- ============================================================
-- 7. OPERATIONS / MONITORING
-- ============================================================
CREATE TABLE queue_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          VARCHAR(64) NOT NULL UNIQUE,
  queue_name      VARCHAR(64) NOT NULL,
  job_type        VARCHAR(64) NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          VARCHAR(32) NOT NULL DEFAULT 'WAITING',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_queue_jobs_status_queue ON queue_jobs (status, queue_name);
CREATE INDEX idx_queue_jobs_scheduled ON queue_jobs (scheduled_at);

CREATE TABLE worker_statuses (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  worker_id         VARCHAR(64) NOT NULL UNIQUE,
  host              VARCHAR(255),
  status            worker_status NOT NULL DEFAULT 'IDLE',
  current_job_id    UUID REFERENCES queue_jobs(id),
  last_heartbeat    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_processed   INTEGER NOT NULL DEFAULT 0,
  total_failed      INTEGER NOT NULL DEFAULT 0,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE system_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level           log_level NOT NULL,
  source_module   VARCHAR(64) NOT NULL,
  event_code      VARCHAR(64),
  message         TEXT NOT NULL,
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_system_logs_level_time ON system_logs (level, created_at DESC);
CREATE INDEX idx_system_logs_source_time ON system_logs (source_module, created_at DESC);

CREATE TABLE settings (
  key           VARCHAR(64) PRIMARY KEY,
  value         JSONB NOT NULL,
  description   TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 8. TRIGGERS / BUSINESS RULES
-- ============================================================

-- Composite version must self-reference BASE strategies only
CREATE OR REPLACE FUNCTION check_composite_components()
RETURNS TRIGGER AS $$
DECLARE
  comp_type strategy_type;
  comp_type_str TEXT;
BEGIN
  SELECT type INTO comp_type FROM strategy_definitions WHERE id = (
    SELECT definition_id FROM strategy_versions WHERE id = NEW.composite_version_id
  );
  SELECT type::TEXT INTO comp_type_str FROM strategy_definitions WHERE id = (
    SELECT definition_id FROM strategy_versions WHERE id = NEW.composite_version_id
  );

  IF comp_type_str IS DISTINCT FROM 'COMPOSITE' THEN
    RAISE EXCEPTION 'composite_components.parent must be a COMPOSITE strategy version';
  END IF;
  IF NEW.composite_version_id = NEW.component_version_id THEN
    RAISE EXCEPTION 'composite strategy cannot include itself';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_composite_components
BEFORE INSERT OR UPDATE ON composite_components
FOR EACH ROW EXECUTE FUNCTION check_composite_components();

-- One leaderboard entry per strategy_version+symbol+timeframe enforced by UNIQUE
-- Trade entry < exit when both present
ALTER TABLE trades
  ADD CONSTRAINT trades_exit_after_entry CHECK (exit_time IS NULL OR exit_time > entry_time);

-- Experiments immutable after DONE
CREATE OR REPLACE FUNCTION lock_finished_experiment()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'DONE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'experiment % is immutable after DONE', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lock_finished_experiment
BEFORE UPDATE ON experiments
FOR EACH ROW EXECUTE FUNCTION lock_finished_experiment();
```

---

## Prisma Schema

```prisma
// schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// ENUMS
// ============================================================
enum StrategyType     { BASE COMPOSITE }
enum StrategyFamily   { TREND MOMENTUM STRUCTURE VOLATILITY SENTIMENT }
enum SentimentClass   { POSITIVE NEUTRAL NEGATIVE }
enum PositionType     { LONG SHORT }
enum TradeSide        { BUY SELL }
enum ExperimentStatus { PENDING RUNNING DONE FAILED STOPPED }
enum CandidateStatus  { PENDING QUEUED RUNNING DONE FAILED SKIPPED }
enum SearchStatus     { PENDING RUNNING DONE STOPPED FAILED }
enum WorkerStatus     { IDLE BUSY OFFLINE ERROR }
enum LogLevel         { DEBUG INFO WARN ERROR }

// ============================================================
// MARKET DATA
// ============================================================
model MarketDataProvider {
  id        String   @id @default(uuid()) @db.Uuid
  code      String   @unique
  name      String
  baseUrl   String
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")
  symbols   Symbol[]
  @@map("market_data_providers")
}

model Symbol {
  id          String   @id @default(uuid()) @db.Uuid
  providerId  String   @map("provider_id") @db.Uuid
  symbol      String
  baseAsset   String   @map("base_asset")
  quoteAsset  String   @map("quote_asset")
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  provider    MarketDataProvider @relation(fields: [providerId], references: [id])
  candles     Candle[]
  newsCoins   NewsCoin[]
  searchRuns  SearchRun[]
  experiments Experiment[]
  backtestResults BacktestResult[]
  leaderboardEntries LeaderboardEntry[]
  trades      Trade[]
  @@unique([providerId, symbol])
  @@map("symbols")
}

model Candle {
  id          String   @id @default(uuid()) @db.Uuid
  symbolId    String   @map("symbol_id") @db.Uuid
  timeframe   String
  openTime    BigInt   @map("open_time")
  closeTime   BigInt   @map("close_time")
  open        Decimal  @db.Decimal(24,10)
  high        Decimal  @db.Decimal(24,10)
  low         Decimal  @db.Decimal(24,10)
  close       Decimal  @db.Decimal(24,10)
  volume      Decimal  @db.Decimal(32,10)
  quoteVolume Decimal  @map("quote_volume") @db.Decimal(32,10)
  trades      Int
  createdAt   DateTime @default(now()) @map("created_at")
  symbol      Symbol   @relation(fields: [symbolId], references: [id], onDelete: Cascade)
  @@unique([symbolId, timeframe, openTime])
  @@index([symbolId, timeframe, openTime(sort: Desc)])
  @@map("candles")
}

// ============================================================
// STRATEGY
// ============================================================
model IndicatorType {
  id          String   @id @default(uuid()) @db.Uuid
  code        String   @unique
  name        String
  category    StrategyFamily
  description String?
  createdAt   DateTime @default(now()) @map("created_at")
  strategyVersions StrategyVersion[]
  @@map("indicator_types")
}

model StrategyDefinition {
  id          String   @id @default(uuid()) @db.Uuid
  type        StrategyType
  family      StrategyFamily
  description String?
  createdAt   DateTime @default(now()) @map("created_at")
  versions    StrategyVersion[]
  registry    StrategyRegistry?
  @@map("strategy_definitions")
}

model StrategyVersion {
  id                String   @id @default(uuid()) @db.Uuid
  definitionId      String   @map("definition_id") @db.Uuid
  version           String
  name              String
  description       String?
  indicatorTypeId   String?  @map("indicator_type_id") @db.Uuid
  implementationRef String   @map("implementation_ref")
  parameters        Json     @default("{}")
  isActive          Boolean  @default(true) @map("is_active")
  createdAt         DateTime @default(now()) @map("created_at")
  definition        StrategyDefinition @relation(fields: [definitionId], references: [id], onDelete: Cascade)
  indicatorType     IndicatorType? @relation(fields: [indicatorTypeId], references: [id])
  compositeParent   CompositeComponent[] @relation("CompositeParent")
  compositeChild    CompositeComponent[] @relation("CompositeChild")
  candidates        CandidateStrategy[]
  leaderboardEntries LeaderboardEntry[]
  rankingHistory    RankingHistory[]
  @@unique([definitionId, version])
  @@map("strategy_versions")
}

model CompositeComponent {
  compositeVersionId String  @map("composite_version_id") @db.Uuid
  componentVersionId String  @map("component_version_id") @db.Uuid
  weight             Decimal @db.Decimal(6,4)
  position           Int
  compositeVersion   StrategyVersion @relation("CompositeParent", fields: [compositeVersionId], references: [id], onDelete: Cascade)
  componentVersion   StrategyVersion @relation("CompositeChild",  fields: [componentVersionId], references: [id], onDelete: Restrict)
  @@id([compositeVersionId, componentVersionId])
  @@map("composite_components")
}

model StrategyRegistry {
  id           String   @id @default(uuid()) @db.Uuid
  definitionId String   @unique @map("definition_id") @db.Uuid
  registeredAt DateTime @default(now()) @map("registered_at")
  isEnabled    Boolean  @default(true) @map("is_enabled")
  definition   StrategyDefinition @relation(fields: [definitionId], references: [id], onDelete: Cascade)
  @@map("strategy_registry")
}

// ============================================================
// SEARCH
// ============================================================
model SearchAlgorithm {
  id                 String   @id @default(uuid()) @db.Uuid
  code               String   @unique
  name               String
  implementationRef  String   @map("implementation_ref")
  createdAt          DateTime @default(now()) @map("created_at")
  searchRuns         SearchRun[]
  @@map("search_algorithms")
}

model SearchRun {
  id             String   @id @default(uuid()) @db.Uuid
  algorithmId    String   @map("algorithm_id") @db.Uuid
  symbolId       String   @map("symbol_id") @db.Uuid
  timeframe      String
  maxCandidates  Int      @map("max_candidates")
  fromTime       BigInt?  @map("from_time")
  toTime         BigInt?  @map("to_time")
  status         SearchStatus @default(PENDING)
  startedAt      DateTime? @map("started_at")
  finishedAt     DateTime? @map("finished_at")
  createdBy      String?  @map("created_by")
  config         Json     @default("{}")
  createdAt      DateTime @default(now()) @map("created_at")
  algorithm      SearchAlgorithm @relation(fields: [algorithmId], references: [id])
  symbol         Symbol   @relation(fields: [symbolId], references: [id])
  candidates     CandidateStrategy[]
  @@map("search_runs")
}

model CandidateStrategy {
  id                String   @id @default(uuid()) @db.Uuid
  searchRunId       String   @map("search_run_id") @db.Uuid
  strategyVersionId String   @map("strategy_version_id") @db.Uuid
  parameters        Json     @default("{}")
  status            CandidateStatus @default(PENDING)
  errorMessage      String?  @map("error_message")
  createdAt         DateTime @default(now()) @map("created_at")
  searchRun         SearchRun      @relation(fields: [searchRunId], references: [id], onDelete: Cascade)
  strategyVersion   StrategyVersion @relation(fields: [strategyVersionId], references: [id])
  experiments       Experiment[]
  @@map("candidate_strategies")
}

// ============================================================
// EXPERIMENT / BACKTEST
// ============================================================
model Experiment {
  id              String   @id @default(uuid()) @db.Uuid
  candidateId     String   @map("candidate_id") @db.Uuid
  name            String
  description     String?
  symbolId        String   @map("symbol_id") @db.Uuid
  timeframe       String
  fromTime        BigInt   @map("from_time")
  toTime          BigInt   @map("to_time")
  initialCapital  Decimal  @default(10000) @map("initial_capital") @db.Decimal(24,8)
  positionSize    Decimal  @map("position_size") @db.Decimal(24,8)
  positionType    PositionType @default(LONG) @map("position_type")
  status          ExperimentStatus @default(PENDING)
  errorMessage    String?  @map("error_message")
  createdAt       DateTime @default(now()) @map("created_at")
  finishedAt      DateTime? @map("finished_at")
  candidate       CandidateStrategy @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  symbol          Symbol   @relation(fields: [symbolId], references: [id])
  backtestResult  BacktestResult?
  evaluationMetrics EvaluationMetric[]
  trades          Trade[]
  @@map("experiments")
}

model BacktestResult {
  id                 String   @id @default(uuid()) @db.Uuid
  experimentId       String   @unique @map("experiment_id") @db.Uuid
  symbolId           String   @map("symbol_id") @db.Uuid
  timeframe          String
  fromTime           BigInt   @map("from_time")
  toTime             BigInt   @map("to_time")
  initialCapital     Decimal  @map("initial_capital") @db.Decimal(24,8)
  finalCapital       Decimal  @map("final_capital") @db.Decimal(24,8)
  totalReturn        Decimal  @map("total_return") @db.Decimal(10,4)
  annualReturn       Decimal? @map("annual_return") @db.Decimal(10,4)
  winRate            Decimal  @map("win_rate") @db.Decimal(6,4)
  maxDrawdown        Decimal  @map("max_drawdown") @db.Decimal(10,4)
  numTrades          Int      @map("num_trades")
  numWinningTrades   Int      @map("num_winning_trades")
  numLosingTrades    Int      @map("num_losing_trades")
  sharpeRatio        Decimal? @map("sharpe_ratio") @db.Decimal(10,4)
  sortinoRatio       Decimal? @map("sortino_ratio") @db.Decimal(10,4)
  overallScore       Decimal  @map("overall_score") @db.Decimal(10,4)
  equityCurve        Json     @default("[]") @map("equity_curve")
  createdAt          DateTime @default(now()) @map("created_at")
  experiment         Experiment @relation(fields: [experimentId], references: [id], onDelete: Cascade)
  symbol             Symbol   @relation(fields: [symbolId], references: [id])
  @@map("backtest_results")
}

model EvaluationMetric {
  id            String   @id @default(uuid()) @db.Uuid
  experimentId  String   @map("experiment_id") @db.Uuid
  metricCode    String   @map("metric_code")
  metricValue   Decimal  @map("metric_value") @db.Decimal(20,8)
  metricGroup   String?  @map("metric_group")
  createdAt     DateTime @default(now()) @map("created_at")
  experiment    Experiment @relation(fields: [experimentId], references: [id], onDelete: Cascade)
  @@unique([experimentId, metricCode])
  @@map("evaluation_metrics")
}

model Trade {
  id             String   @id @default(uuid()) @db.Uuid
  experimentId   String   @map("experiment_id") @db.Uuid
  symbolId       String   @map("symbol_id") @db.Uuid
  side           TradeSide
  position       PositionType
  entryTime      BigInt   @map("entry_time")
  entryPrice     Decimal  @map("entry_price") @db.Decimal(24,10)
  exitTime       BigInt?  @map("exit_time")
  exitPrice      Decimal? @map("exit_price") @db.Decimal(24,10)
  quantity       Decimal  @db.Decimal(24,10)
  profitLoss     Decimal? @map("profit_loss") @db.Decimal(24,8)
  profitLossPct  Decimal? @map("profit_loss_pct") @db.Decimal(10,4)
  entryReason    String?  @map("entry_reason")
  exitReason     String?  @map("exit_reason")
  createdAt      DateTime @default(now()) @map("created_at")
  experiment     Experiment @relation(fields: [experimentId], references: [id], onDelete: Cascade)
  symbol         Symbol   @relation(fields: [symbolId], references: [id])
  @@index([experimentId, entryTime])
  @@map("trades")
}

// ============================================================
// LEADERBOARD
// ============================================================
model LeaderboardEntry {
  id                  String   @id @default(uuid()) @db.Uuid
  strategyVersionId   String   @map("strategy_version_id") @db.Uuid
  symbolId            String   @map("symbol_id") @db.Uuid
  timeframe           String
  totalReturn         Decimal  @map("total_return") @db.Decimal(10,4)
  winRate             Decimal  @map("win_rate") @db.Decimal(6,4)
  maxDrawdown         Decimal  @map("max_drawdown") @db.Decimal(10,4)
  numTrades           Int      @map("num_trades")
  overallScore        Decimal  @map("overall_score") @db.Decimal(10,4)
  rank                Int
  lastEvaluatedAt     DateTime @default(now()) @map("last_evaluated_at")
  strategyVersion     StrategyVersion @relation(fields: [strategyVersionId], references: [id], onDelete: Cascade)
  symbol              Symbol   @relation(fields: [symbolId], references: [id])
  @@unique([strategyVersionId, symbolId, timeframe])
  @@index([overallScore(sort: Desc)])
  @@map("leaderboard_entries")
}

model RankingHistory {
  id                  String   @id @default(uuid()) @db.Uuid
  strategyVersionId   String   @map("strategy_version_id") @db.Uuid
  rank                Int
  overallScore        Decimal  @map("overall_score") @db.Decimal(10,4)
  snapshotAt          DateTime @default(now()) @map("snapshot_at")
  datasetLabel        String?  @map("dataset_label")
  strategyVersion     StrategyVersion @relation(fields: [strategyVersionId], references: [id], onDelete: Cascade)
  @@unique([strategyVersionId, snapshotAt])
  @@index([strategyVersionId, snapshotAt(sort: Desc)])
  @@map("ranking_history")
}

// ============================================================
// NEWS / SENTIMENT
// ============================================================
model NewsProvider {
  id            String   @id @default(uuid()) @db.Uuid
  code          String   @unique
  name          String
  baseUrl       String   @map("base_url")
  requiresApiKey Boolean @default(false) @map("requires_api_key")
  isActive      Boolean  @default(true) @map("is_active")
  createdAt     DateTime @default(now()) @map("created_at")
  news          News[]
  @@map("news_providers")
}

model News {
  id            String   @id @default(uuid()) @db.Uuid
  providerId    String   @map("provider_id") @db.Uuid
  externalId    String   @map("external_id")
  title         String
  summary       String?
  content       String?
  url           String
  source        String
  author        String?
  publishedAt   DateTime @map("published_at")
  crawledAt     DateTime @default(now()) @map("crawled_at")
  provider      NewsProvider @relation(fields: [providerId], references: [id])
  coins         NewsCoin[]
  sentiments    Sentiment[]
  @@unique([providerId, externalId])
  @@index([publishedAt(sort: Desc)])
  @@map("news")
}

model NewsCoin {
  newsId    String @map("news_id") @db.Uuid
  symbolId  String @map("symbol_id") @db.Uuid
  news      News @relation(fields: [newsId], references: [id], onDelete: Cascade)
  symbol    Symbol @relation(fields: [symbolId], references: [id], onDelete: Cascade)
  @@id([newsId, symbolId])
  @@map("news_coins")
}

model SentimentProvider {
  id            String   @id @default(uuid()) @db.Uuid
  code          String   @unique
  name          String
  modelVersion  String   @map("model_version")
  isActive      Boolean  @default(true) @map("is_active")
  createdAt     DateTime @default(now()) @map("created_at")
  sentiments    Sentiment[]
  @@map("sentiment_providers")
}

model Sentiment {
  id              String   @id @default(uuid()) @db.Uuid
  newsId          String   @map("news_id") @db.Uuid
  providerId      String   @map("provider_id") @db.Uuid
  classification  SentimentClass
  score           Decimal  @db.Decimal(4,3)
  confidence      Decimal? @db.Decimal(4,3)
  analyzedAt      DateTime @default(now()) @map("analyzed_at")
  news            News @relation(fields: [newsId], references: [id], onDelete: Cascade)
  provider        SentimentProvider @relation(fields: [providerId], references: [id])
  @@unique([newsId, providerId])
  @@index([classification])
  @@map("sentiments")
}

// ============================================================
// OPERATIONS / MONITORING
// ============================================================
model QueueJob {
  id            String   @id @default(uuid()) @db.Uuid
  jobId         String   @unique @map("job_id")
  queueName     String   @map("queue_name")
  jobType       String   @map("job_type")
  payload       Json     @default("{}")
  status        String   @default("WAITING")
  attempts      Int      @default(0)
  maxAttempts   Int      @default(3) @map("max_attempts")
  scheduledAt   DateTime @default(now()) @map("scheduled_at")
  startedAt     DateTime? @map("started_at")
  finishedAt    DateTime? @map("finished_at")
  errorMessage  String?  @map("error_message")
  createdAt     DateTime @default(now()) @map("created_at")
  worker        WorkerStatus? @relation(fields: [currentJobId], references: [id])
  @@index([status, queueName])
  @@map("queue_jobs")
}

model WorkerStatus {
  id              String   @id @default(uuid()) @db.Uuid
  workerId        String   @unique @map("worker_id")
  host            String?
  status          WorkerStatus @default(IDLE)
  currentJobId    String?  @map("current_job_id") @db.Uuid
  lastHeartbeat   DateTime @default(now()) @map("last_heartbeat")
  totalProcessed  Int      @default(0) @map("total_processed")
  totalFailed     Int      @default(0) @map("total_failed")
  startedAt       DateTime @default(now()) @map("started_at")
  createdAt       DateTime @default(now()) @map("created_at")
  jobs            QueueJob[]
  @@map("worker_statuses")
}

model SystemLog {
  id            String   @id @default(uuid()) @db.Uuid
  level         LogLevel
  sourceModule  String   @map("source_module")
  eventCode     String?  @map("event_code")
  message       String
  context       Json     @default("{}")
  createdAt     DateTime @default(now()) @map("created_at")
  @@index([level, createdAt(sort: Desc)])
  @@index([sourceModule, createdAt(sort: Desc)])
  @@map("system_logs")
}

model Setting {
  key         String   @id
  value       Json
  description String?
  updatedAt   DateTime @default(now()) @map("updated_at")
  @@map("settings")
}
```

---

## Index Summary

| Table | Index | Purpose |
|-------|-------|---------|
| `candles` | `(symbol_id, timeframe, open_time DESC)` | Chart queries by timeframe |
| `candles` | `(open_time DESC)` | Global time-window scans |
| `trades` | `(experiment_id, entry_time)` | Trade list per experiment |
| `leaderboard_entries` | `(overall_score DESC)` | Top-K ranking |
| `leaderboard_entries` | `(symbol_id, timeframe, overall_score DESC)` | Filtered leaderboard |
| `ranking_history` | `(strategy_version_id, snapshot_at DESC)` | Per-strategy history |
| `news` | `(published_at DESC)` | News feed |
| `news` | `(provider_id, published_at DESC)` | Provider-scoped news |
| `queue_jobs` | `(status, queue_name)` | Queue dashboard |
| `system_logs` | `(level, created_at DESC)` | Log filtering |
| `system_logs` | `(source_module, created_at DESC)` | Module-scoped logs |

---

## Key Business Rules Enforced

| Rule | Enforcement |
|------|-------------|
| Candle unique by (symbol, timeframe, open_time) | `UNIQUE` constraint |
| Composite strategy ≥ 2 components | `composite_components` PK + `MAX(position)` check |
| Composite weights sum = 1.0 | `CHECK` + application validation |
| Tổng weight = 1.0 | Trigger `trg_check_composite_components` |
| Experiment immutable after DONE | Trigger `trg_lock_finished_experiment` |
| Trade `exit_time > entry_time` | `CHECK` constraint |
| News no duplicate per provider | `UNIQUE(provider_id, external_id)` |
| Sentiment no duplicate per model | `UNIQUE(news_id, provider_id)` |
| Sentiment score [-1, 1] | `CHECK` constraint |
| One leaderboard entry per strategy+symbol+timeframe | `UNIQUE` constraint |
| OHLC integrity | `CHECK` constraint on `candles` |
| Top-K limit | Enforced via application query (`LIMIT K`) |