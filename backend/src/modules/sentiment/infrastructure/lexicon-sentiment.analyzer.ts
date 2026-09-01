import { SentimentAnalysisResult, SentimentAnalyzer } from "../domain/sentiment.entity";

export class LexiconSentimentAnalyzer implements SentimentAnalyzer {
  public readonly providerCode = "LEXICON_V1";
  public readonly providerName = "Rule-Based Lexicon Sentiment Analyzer";

  private positiveWords = new Set([
    "bullish", "surge", "surges", "pump", "gain", "gains", "ath", "breakout", "skyrocket",
    "rally", "inflow", "inflows", "soar", "soars", "optimistic", "growth", "highs", "uptrend",
    "adoption", "partner", "partnership", "support", "sec", "approval", "etf"
  ]);

  private negativeWords = new Set([
    "bearish", "crash", "crashes", "dump", "drop", "drops", "fall", "falls", "plunge",
    "fud", "scam", "hack", "hacked", "loss", "losses", "risk", "ban", "lawsuit", "downside",
    "liquidation", "downtrend", "panic", "collapse", "investigation"
  ]);

  public async analyzeText(text: string): Promise<SentimentAnalysisResult> {
    if (!text || text.trim().length === 0) {
      return { classification: "NEUTRAL", score: 0, confidence: 0.5 };
    }

    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
    let posCount = 0;
    let negCount = 0;

    for (const word of words) {
      if (this.positiveWords.has(word)) posCount++;
      if (this.negativeWords.has(word)) negCount++;
    }

    const totalMatches = posCount + negCount;
    if (totalMatches === 0) {
      return { classification: "NEUTRAL", score: 0, confidence: 0.6 };
    }

    const rawScore = (posCount - negCount) / totalMatches; // Range [-1.0, 1.0]
    const confidence = Math.min(0.95, 0.5 + totalMatches * 0.1);

    let classification: "POSITIVE" | "NEUTRAL" | "NEGATIVE" = "NEUTRAL";
    if (rawScore > 0.15) {
      classification = "POSITIVE";
    } else if (rawScore < -0.15) {
      classification = "NEGATIVE";
    }

    return {
      classification,
      score: Math.round(rawScore * 1000) / 1000,
      confidence: Math.round(confidence * 100) / 100,
    };
  }
}
