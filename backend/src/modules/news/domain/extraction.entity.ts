export interface ExtractionFieldSelectors {
  titleSelector: string;
  summarySelector?: string | null;
  contentSelector?: string | null;
  sourceSelector?: string | null;
}

export interface ExtractionTemplateEntity extends ExtractionFieldSelectors {
  id: string;
  domain: string;
  version: string;
  confidenceScore: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface QualityValidationResult {
  totalItems: number;
  validItems: number;
  failedItems: number;
  errorRate: number; // [0.0, 1.0]
  requiresHealing: boolean;
  failedFields: string[];
}

export interface SelfHealingResult {
  healed: boolean;
  domain: string;
  previousVersion: string;
  newVersion: string;
  errorRate: number;
  reason: string;
  template?: ExtractionTemplateEntity;
}
