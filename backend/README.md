# Crypto Strategy Lab — Backend

Backend foundation for **Crypto Strategy Lab**.
A single deployable Node.js service built as a **modular monolith**
with **layered architecture** and **event-driven** inter-module
communication.

> **Status:** Foundation only. Module owners will fill in business
> logic in subsequent tasks. The skeleton, contracts, and shared
> infrastructure are already in place so that 4 people can develop
> in parallel without stepping on each other.

---

## Tech stack

| Concern          | Choice                                        |
| ---------------- | --------------------------------------------- |
| Runtime          | Node.js ≥ 18.18                               |
| Language         | TypeScript (strict)                           |
| HTTP framework   | Express.js                                    |
| Realtime         | Socket.IO                                     |
| Database         | PostgreSQL (Supabase) via Prisma ORM          |
| Queue            | BullMQ on Redis (`ioredis`)                   |
| Event bus        | `node:events` EventEmitter (centralised)      |
| Logging          | `pino` structured logging                     |
| Validation       | `zod`                                         |
| Testing          | `vitest` + `supertest`                        |
| Type-check / dev | `tsx`                                         |

---

## Quick start

```bash
# 1. Install
cd backend
npm install

# 2. Configure environment
cp .env.example .env
# edit .env to point at your PostgreSQL + Redis instances

# 3. Generate the Prisma client
npm run prisma:generate

# 4. Apply migrations
npm run prisma:migrate

# 5. Optional: apply reference seed (does NOT insert business fixtures)
npx prisma db seed

# 6. Run in dev mode (TS + hot reload)
npm run dev

# 7. Smoke test
curl http://localhost:3000/api/health
```

Expected response:

```json
{
  "success": true,
  "service": "crypto-strategy-lab-backend",
  "status": "ok",
  "env": "development",
  "uptimeSeconds": 12,
  "timestamp": "2026-08-13T15:59:00.000Z"
}
```

---

## Available scripts

| Command                | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Run with `tsx watch` (auto reload)                    |
| `npm run build`        | Compile TypeScript to `dist/`                        |
| `npm start`            | Run compiled output                                   |
| `npm run typecheck`    | Type-check without emit                               |
| `npm test`             | Run vitest once                                       |
| `npm run test:watch`   | Run vitest in watch mode                              |
| `npm run prisma:*`     | Prisma helpers (generate / migrate / format)         |
| `npx prisma db seed`   | Apply reference seed (idempotent, no business data)   |

---

## Project layout

```
backend/
├── prisma/
│   ├── schema.prisma          ← mirrors docs/Database.md
│   └── seed.ts                ← minimal reference seed only
├── src/
│   ├── app.ts                 ← Express factory (no .listen())
│   ├── server.ts              ← entrypoint: HTTP + Socket.IO + shutdown
│   ├── config/                ← env loading + validation (zod)
│   ├── shared/                ← cross-cutting concerns
│   │   ├── event-bus/         ← in-process EventEmitter abstraction
│   │   ├── logger/            ← shared Pino logger
│   │   ├── errors/            ← AppError + global error handler
│   │   └── types/             ← only truly cross-module types
│   ├── infrastructure/        ← adapters to external systems
│   │   ├── database/          ← Prisma client singleton
│   │   ├── queue/             ← Redis/BullMQ connection
│   │   └── websocket/         ← Socket.IO server factory
│   ├── modules/               ← modular monolith (one folder per module)
│   │   ├── market-data/       ← Bảo
│   │   ├── strategy/          ← Trí
│   │   ├── search/            ← Trí
│   │   ├── backtest/          ← Huy
│   │   ├── evaluation/        ← Nhân
│   │   ├── leaderboard/       ← Nhân
│   │   ├── news/              ← Nhân
│   │   └── sentiment/         ← Nhân
│   │       └── (each module)
│   │           ├── domain/         ← ports + value objects, no infra
│   │           ├── application/    ← use cases, domain-only deps
│   │           ├── infrastructure/ ← adapters (Prisma, BullMQ, …)
│   │           ├── presentation/   ← Express controllers
│   │           ├── index.ts
│   │           └── README.md
│   └── api/
│       ├── routes/            ← /api/* aggregator + health
│       └── middleware/        ← error + 404 handlers
├── tests/
│   └── health.test.ts         ← smoke test for /api/health
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── tsconfig.test.json
├── vitest.config.ts
└── README.md
```

---

## Architectural rules (enforced by code review)

### Required dependency direction

```
presentation  →  application  →  domain
infrastructure  →  domain (implements ports)
infrastructure  →  application contracts (where strictly required)
```

### Forbidden imports

Modules' `domain/` layers MUST NOT import:

- `@prisma/client`
- `express`
- `ioredis` / `bullmq`
- `socket.io`
- any exchange SDK (Binance, CryptoPanic, Gemini, …)

See `docs/Solution.md` § 4 for the full module decomposition.

### Event bus rules

- Modules MUST publish / subscribe through the shared `EventBus`
  abstraction — never by instantiating `new EventEmitter()`
  directly.
- Subscriber exceptions are isolated: a throwing handler must NEVER
  take down the EventBus (NFR-018).

---

## Environment variables

Copy `.env.example` to `.env` and fill in real values. `DATABASE_URL`
is the only mandatory variable at startup (for Prisma). Everything else
has a development default but **must** be supplied in production.

| Name                   | Required | Example                                             |
| ---------------------- | -------- | --------------------------------------------------- |
| `NODE_ENV`             | No       | `development`                                       |
| `PORT`                 | No       | `3000`                                              |
| `DATABASE_URL`         | **Yes**  | `postgresql://user:pw@host:5432/db`                 |
| `REDIS_HOST`           | No       | `localhost`                                         |
| `REDIS_PORT`           | No       | `6379`                                              |
| `REDIS_PASSWORD`       | No       | (empty)                                             |
| `REDIS_DB`             | No       | `0`                                                 |
| `BINANCE_REST_BASE_URL`| No       | `https://api.binance.com`                           |
| `BINANCE_WS_BASE_URL`  | No       | `wss://stream.binance.com:9443`                     |
| `CRYPTOPANIC_API_KEY`  | No       | (empty until news module wires up)                  |
| `GEMINI_API_KEY`       | No       | (empty until sentiment module wires up)             |
| `CORS_ORIGINS`         | No       | `*` or comma-separated origins                      |

Sensitive values are redacted from logs by the shared Pino logger.

---

## What this foundation does NOT include (yet)

Per the team's module ownership plan, the following belong to later
tasks and are explicitly **not** implemented here:

- MA / RSI / Bollinger / SupportResistance strategies
- Weighted combiner + Strategy registry
- Random / DomainGuided search generators + SearchController
- Backtester algorithm + BacktestWorker (Huy's BullMQ jobs)
- Evaluation metrics + Leaderboard Top-K
- CryptoPanic news adapter + NewsCollectorService
- Gemini sentiment adapter + SentimentService
- All module-specific REST routes (skeleton only mounts `/api/health`)

Each module folder contains a `README.md` and `TODO` comments
describing what the owner must add.
