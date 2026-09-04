import { getPrismaClient } from "../../../infrastructure/database/prisma";
import type { PrismaClient } from "@prisma/client";
import type { ExtractionTemplateEntity, ExtractionFieldSelectors } from "../domain/extraction.entity";

export class ExtractionTemplateManager {
  private readonly prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? getPrismaClient();
  }

  /**
   * Retrieves the currently active ExtractionTemplate for a target domain.
   * If none exists in DB, creates and returns a default baseline template (v1.4.2).
   */
  public async getActiveTemplate(domain: string): Promise<ExtractionTemplateEntity> {
    const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0]!;

    const active = await this.prisma.extractionTemplate.findFirst({
      where: { domain: cleanDomain, isActive: true },
      orderBy: { createdAt: "desc" },
    });

    if (active) {
      return {
        id: active.id,
        domain: active.domain,
        version: active.version,
        titleSelector: active.titleSelector,
        summarySelector: active.summarySelector,
        contentSelector: active.contentSelector,
        sourceSelector: active.sourceSelector,
        confidenceScore: Number(active.confidenceScore),
        isActive: active.isActive,
        createdAt: active.createdAt,
        updatedAt: active.updatedAt,
      };
    }

    // Default template fallback if database table is empty
    return this.createDefaultTemplate(cleanDomain, "v1.4.2");
  }

  /**
   * Calls Gemini LLM to parse a sample HTML page from a domain and generate a CSS selector template.
   * Increments version string (e.g., v1.4.2 -> v1.4.3).
   */
  public async generateTemplateWithLLM(
    domain: string,
    sampleHtml: string,
    reason = "LLM Assisted Template Generation"
  ): Promise<ExtractionTemplateEntity> {
    const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0]!;
    const latest = await this.prisma.extractionTemplate.findFirst({
      where: { domain: cleanDomain },
      orderBy: { createdAt: "desc" },
    });

    const nextVersion = this.incrementVersion(latest?.version ?? "v1.4.1");
    const selectors = await this.callGeminiForSelectors(sampleHtml);

    // Set all previous templates for this domain to inactive
    await this.prisma.extractionTemplate.updateMany({
      where: { domain: cleanDomain, isActive: true },
      data: { isActive: false },
    });

    const created = await this.prisma.extractionTemplate.create({
      data: {
        domain: cleanDomain,
        version: nextVersion,
        titleSelector: selectors.titleSelector || "h1, .article-title, .entry-title",
        summarySelector: selectors.summarySelector || "p.summary, .article-excerpt, p",
        contentSelector: selectors.contentSelector || ".article-body, .entry-content, article",
        sourceSelector: selectors.sourceSelector || ".author, .source, span.byline",
        confidenceScore: 0.92,
        isActive: true,
      },
    });

    return {
      id: created.id,
      domain: created.domain,
      version: created.version,
      titleSelector: created.titleSelector,
      summarySelector: created.summarySelector,
      contentSelector: created.contentSelector,
      sourceSelector: created.sourceSelector,
      confidenceScore: Number(created.confidenceScore),
      isActive: created.isActive,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  private incrementVersion(currentVersion: string): string {
    const match = currentVersion.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return "v1.0.0";
    const major = match[1]!;
    const minor = match[2]!;
    const patch = parseInt(match[3]!, 10) + 1;
    return `v${major}.${minor}.${patch}`;
  }

  private async callGeminiForSelectors(html: string): Promise<ExtractionFieldSelectors> {
    const apiKey = process.env.GEMINI_API_KEY;
    const truncatedHtml = html.slice(0, 8000); // Truncate to save tokens

    if (!apiKey) {
      return {
        titleSelector: "h1.article-title, h1, .title",
        summarySelector: "p.summary, .excerpt, p",
        contentSelector: ".article-content, article, body",
        sourceSelector: "span.source, .author",
      };
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Analyze this HTML webpage snippet from a crypto news website. Identify CSS selectors to extract: title, summary, content, and source. Respond strictly with JSON: {"titleSelector": string, "summarySelector": string, "contentSelector": string, "sourceSelector": string}.\n\nHTML:\n${truncatedHtml}`,
                  },
                ],
              },
            ],
            generationConfig: { responseMimeType: "application/json" },
          }),
        }
      );

      if (!response.ok) throw new Error("Gemini API error");

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Empty response");

      return JSON.parse(text) as ExtractionFieldSelectors;
    } catch {
      return {
        titleSelector: "h1.article-title, h1, .title",
        summarySelector: "p.summary, .excerpt, p",
        contentSelector: ".article-content, article, body",
        sourceSelector: "span.source, .author",
      };
    }
  }

  private async createDefaultTemplate(domain: string, version: string): Promise<ExtractionTemplateEntity> {
    const created = await this.prisma.extractionTemplate.create({
      data: {
        domain,
        version,
        titleSelector: "h1.article-title, h1, .entry-title",
        summarySelector: "p.summary, .article-excerpt, p",
        contentSelector: ".article-body, .entry-content, article",
        sourceSelector: "span.source, .author, .byline",
        confidenceScore: 0.92,
        isActive: true,
      },
    });

    return {
      id: created.id,
      domain: created.domain,
      version: created.version,
      titleSelector: created.titleSelector,
      summarySelector: created.summarySelector,
      contentSelector: created.contentSelector,
      sourceSelector: created.sourceSelector,
      confidenceScore: Number(created.confidenceScore),
      isActive: created.isActive,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }
}
