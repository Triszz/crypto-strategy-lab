import { getPrismaClient } from "../../../infrastructure/database/prisma";
import type { PrismaClient } from "@prisma/client";
import type { QualityValidationResult, SelfHealingResult } from "../domain/extraction.entity";
import { ExtractionTemplateManager } from "./llm-extraction.template-manager";
import { logger } from "../../../shared/logger/logger";

export class SelfHealingOrchestrator {
  private readonly prisma: PrismaClient;
  private readonly templateManager: ExtractionTemplateManager;
  private isAutoHealingEnabled = true;

  constructor(templateManager?: ExtractionTemplateManager, prisma?: PrismaClient) {
    this.prisma = prisma ?? getPrismaClient();
    this.templateManager = templateManager ?? new ExtractionTemplateManager(this.prisma);
  }

  public setAutoHealingEnabled(enabled: boolean): void {
    this.isAutoHealingEnabled = enabled;
  }

  public isAutoHealing(): boolean {
    return this.isAutoHealingEnabled;
  }

  /**
   * Validates a batch of extracted news items to check if error rate exceeds 10%.
   */
  public validateBatchQuality(
    items: ReadonlyArray<{ title?: string | null; summary?: string | null }>
  ): QualityValidationResult {
    if (items.length === 0) {
      return {
        totalItems: 0,
        validItems: 0,
        failedItems: 0,
        errorRate: 0,
        requiresHealing: false,
        failedFields: [],
      };
    }

    let failedCount = 0;
    const failedFieldsSet = new Set<string>();

    for (const item of items) {
      let itemFailed = false;
      if (!item.title || item.title.trim().length === 0) {
        itemFailed = true;
        failedFieldsSet.add("title");
      }
      if (itemFailed) {
        failedCount++;
      }
    }

    const errorRate = Math.round((failedCount / items.length) * 1000) / 1000;
    // Trigger healing if error rate > 10% (0.10)
    const requiresHealing = errorRate > 0.1 && this.isAutoHealingEnabled;

    return {
      totalItems: items.length,
      validItems: items.length - failedCount,
      failedItems: failedCount,
      errorRate,
      requiresHealing,
      failedFields: Array.from(failedFieldsSet),
    };
  }

  /**
   * Triggers the Self-Healing process: calls Gemini LLM to generate a new extraction template
   * version, saves the SelfHealingLog to DB, and returns the result.
   */
  public async handleSelfHealing(
    domain: string,
    sampleHtml: string,
    errorRate: number,
    reason = "Extracted field null rate exceeded 10% threshold"
  ): Promise<SelfHealingResult> {
    const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0]!;
    const activeTemplate = await this.templateManager.getActiveTemplate(cleanDomain);

    logger.warn(
      { domain: cleanDomain, currentVersion: activeTemplate.version, errorRate, reason },
      "SelfHealingOrchestrator: Error rate threshold exceeded. Triggering LLM auto-healing."
    );

    const newTemplate = await this.templateManager.generateTemplateWithLLM(
      cleanDomain,
      sampleHtml,
      `Self-Healing Fix: ${reason}`
    );

    await this.prisma.selfHealingLog.create({
      data: {
        domain: cleanDomain,
        previousVersion: activeTemplate.version,
        newVersion: newTemplate.version,
        errorRate,
        reason,
      },
    });

    logger.info(
      { domain: cleanDomain, oldVersion: activeTemplate.version, newVersion: newTemplate.version },
      "SelfHealingOrchestrator: Auto-healing complete. Upgraded extraction template version."
    );

    return {
      healed: true,
      domain: cleanDomain,
      previousVersion: activeTemplate.version,
      newVersion: newTemplate.version,
      errorRate,
      reason,
      template: newTemplate,
    };
  }
}
