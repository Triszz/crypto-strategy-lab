/**
 * strategy · application · SavedStrategyRepository.port
 *
 * Port interface for persisting user-saved strategies. The Strategy
 * Engine application depends on this port; the concrete Prisma
 * implementation lives in `PrismaSavedStrategyRepository.ts`.
 *
 * MUST stay infrastructure-free in this file.
 */
import type { StrategyEngineJson, StrategySource } from "../domain/StrategyEngineJson";

export interface SavedStrategyRecord {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly jsonDef: Readonly<Record<string, unknown>>;
  readonly source: StrategySource;
  readonly tags: ReadonlyArray<string>;
  readonly ownerId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateSavedStrategyInput {
  readonly name: string;
  readonly version: string;
  readonly description?: string | null;
  readonly jsonDef: StrategyEngineJson;
  readonly source: StrategySource;
  readonly tags?: ReadonlyArray<string>;
  readonly ownerId?: string | null;
}

export interface ListSavedStrategyFilter {
  readonly ownerId?: string;
  readonly source?: StrategySource;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface SavedStrategyRepository {
  create(input: CreateSavedStrategyInput): Promise<SavedStrategyRecord>;
  get(id: string): Promise<SavedStrategyRecord | null>;
  list(filter?: ListSavedStrategyFilter): Promise<ReadonlyArray<SavedStrategyRecord>>;
}
