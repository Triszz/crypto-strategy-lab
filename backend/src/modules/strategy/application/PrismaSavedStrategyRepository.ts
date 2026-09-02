/**
 * strategy · application · PrismaSavedStrategyRepository
 *
 * Prisma-backed implementation of SavedStrategyRepository.
 */
import { Prisma } from "@prisma/client";
import type { PrismaClient, StrategySource as PrismaStrategySource } from "@prisma/client";
import type {
  SavedStrategyRepository,
  SavedStrategyRecord,
  CreateSavedStrategyInput,
  ListSavedStrategyFilter,
} from "./SavedStrategyRepository.port";
import type { StrategySource } from "../domain/StrategyEngineJson";

type PrismaSavedStrategy = Awaited<ReturnType<PrismaClient["savedStrategy"]["create"]>>;

function mapSource(src: PrismaStrategySource): StrategySource {
  if (src === "WEB_IMPORT") return "WEB_IMPORT";
  return "USER_PROMPT";
}

function toRecord(row: PrismaSavedStrategy): SavedStrategyRecord {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    jsonDef: (row.jsonDef as Record<string, unknown>) ?? {},
    source: mapSource(row.source),
    tags: row.tags ?? [],
    ownerId: row.ownerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaSavedStrategyRepository implements SavedStrategyRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async create(input: CreateSavedStrategyInput): Promise<SavedStrategyRecord> {
    const row = await this.prisma.savedStrategy.create({
      data: {
        name: input.name,
        version: input.version,
        description: input.description ?? null,
        jsonDef: input.jsonDef as unknown as Prisma.InputJsonValue,
        source: input.source,
        tags: [...(input.tags ?? [])],
        ownerId: input.ownerId ?? null,
      },
    });
    return toRecord(row);
  }

  public async get(id: string): Promise<SavedStrategyRecord | null> {
    const row = await this.prisma.savedStrategy.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  public async list(
    filter?: ListSavedStrategyFilter,
  ): Promise<ReadonlyArray<SavedStrategyRecord>> {
    const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 200);
    const where: Prisma.SavedStrategyWhereInput = {};
    if (filter?.ownerId) where.ownerId = filter.ownerId;
    if (filter?.source) where.source = filter.source;

    const cursor = filter?.cursor ? { id: filter.cursor } : undefined;

    const rows = await this.prisma.savedStrategy.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });
    return rows.map(toRecord);
  }
}
