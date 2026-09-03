/**
 * search · application · PrismaSearchRepository
 *
 * Prisma-backed implementation of `SearchRepository`.
 *
 * Responsibilities:
 *   - Translate SearchRun / CandidateStrategy domain types ↔ Prisma models.
 *   - Manage Prisma transactions for multi-row operations.
 *   - Translate Prisma errors into application-level errors.
 *
 * This file lives in the application layer (not domain) per DDD layering.
 */
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type {
  SearchRepository,
  SearchRunRecord,
  CandidateRecord,
  CreateSearchRunInput,
  CreateCandidateInput,
  SearchRunStatus,
  CandidateStatus,
  ListSearchRunsFilter,
  AlgorithmSummary,
  SymbolSummary,
} from "./SearchRepository.port";
import type { StrategyParameters } from "../../strategy/domain/StrategyContext";

function mapSearchRunStatus(s: string): SearchRunStatus {
  switch (s) {
    case "PENDING":
    case "RUNNING":
    case "DONE":
    case "STOPPED":
    case "FAILED":
      return s as SearchRunStatus;
    default:
      return "PENDING";
  }
}

function mapCandidateStatus(s: string): CandidateStatus {
  switch (s) {
    case "PENDING":
    case "QUEUED":
    case "RUNNING":
    case "DONE":
    case "FAILED":
    case "SKIPPED":
      return s as CandidateStatus;
    default:
      return "PENDING";
  }
}

type PrismaSearchRun = Awaited<ReturnType<PrismaClient["searchRun"]["create"]>>;
type PrismaCandidate = Awaited<ReturnType<PrismaClient["candidateStrategy"]["create"]>>;

function prismaToSearchRunRecord(r: PrismaSearchRun): SearchRunRecord {
  return {
    id: r.id,
    algorithmId: r.algorithmId,
    symbolId: r.symbolId,
    timeframe: r.timeframe,
    maxCandidates: r.maxCandidates,
    fromTime: r.fromTime ?? undefined,
    toTime: r.toTime ?? undefined,
    status: mapSearchRunStatus(r.status),
    startedAt: r.startedAt ?? undefined,
    finishedAt: r.finishedAt ?? undefined,
    createdBy: r.createdBy ?? undefined,
    config: (r.config as Record<string, unknown>) ?? {},
    createdAt: r.createdAt,
  };
}

function prismaToCandidateRecord(r: PrismaCandidate): CandidateRecord {
  return {
    id: r.id,
    searchRunId: r.searchRunId,
    strategyVersionId: r.strategyVersionId,
    parameters: (r.parameters as StrategyParameters) ?? {},
    status: mapCandidateStatus(r.status),
    errorMessage: r.errorMessage ?? undefined,
    createdAt: r.createdAt,
  };
}

/**
 * SearchRepository backed by Prisma.
 *
 * @param prisma  Injected Prisma client (singleton via `getPrismaClient()` in composition).
 */
export class PrismaSearchRepository implements SearchRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async createSearchRun(input: CreateSearchRunInput): Promise<SearchRunRecord> {
    const row = await this.prisma.searchRun.create({
      data: {
        algorithmId: input.algorithmId,
        symbolId: input.symbolId,
        timeframe: input.timeframe,
        maxCandidates: input.maxCandidates,
        fromTime: input.fromTime,
        toTime: input.toTime,
        createdBy: input.createdBy,
        config: input.config as Prisma.InputJsonValue ?? {},
        status: "PENDING",
      },
    });
    return prismaToSearchRunRecord(row);
  }

  public async updateSearchRunStatus(
    id: string,
    status: SearchRunStatus,
    startedAt?: Date,
    finishedAt?: Date,
  ): Promise<void> {
    await this.prisma.searchRun.update({
      where: { id },
      data: {
        status,
        startedAt: startedAt ?? undefined,
        finishedAt: finishedAt ?? undefined,
      },
    });
  }

  public async createCandidate(input: CreateCandidateInput): Promise<CandidateRecord> {
    const row = await this.prisma.candidateStrategy.create({
      data: {
        searchRunId: input.searchRunId,
        strategyVersionId: input.strategyVersionId,
        parameters: input.parameters as Prisma.InputJsonValue,
        status: input.status ?? "PENDING",
      },
    });
    return prismaToCandidateRecord(row);
  }

  public async getSearchRun(id: string): Promise<SearchRunRecord | null> {
    const row = await this.prisma.searchRun.findUnique({ where: { id } });
    if (!row) return null;
    return prismaToSearchRunRecord(row);
  }

  public async getCandidatesByRun(searchRunId: string): Promise<ReadonlyArray<CandidateRecord>> {
    const rows = await this.prisma.candidateStrategy.findMany({
      where: { searchRunId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(prismaToCandidateRecord);
  }

  public async countCandidatesByRun(searchRunId: string): Promise<number> {
    return this.prisma.candidateStrategy.count({ where: { searchRunId } });
  }

  public async listSearchRuns(
    filter?: ListSearchRunsFilter,
  ): Promise<ReadonlyArray<SearchRunRecord>> {
    const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 200);
    const where: Prisma.SearchRunWhereInput = {};
    if (filter?.status) {
      where.status = filter.status;
    }

    const cursor = filter?.cursor
      ? { id: filter.cursor }
      : undefined;

    const rows = await this.prisma.searchRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });
    return rows.map(prismaToSearchRunRecord);
  }

  public async getAlgorithmSummary(algorithmId: string): Promise<AlgorithmSummary> {
    const row = await this.prisma.searchAlgorithm.findUnique({
      where: { id: algorithmId },
      select: { id: true, code: true, name: true },
    });
    return row ?? { id: algorithmId, code: "unknown", name: "Unknown Algorithm" };
  }

  public async getSymbolSummary(symbolId: string): Promise<SymbolSummary> {
    const row = await this.prisma.symbol.findUnique({
      where: { id: symbolId },
      select: { id: true, symbol: true, baseAsset: true, quoteAsset: true },
    });
    return row ?? { id: symbolId, symbol: "???USDT", baseAsset: "???", quoteAsset: "USDT" };
  }
}
