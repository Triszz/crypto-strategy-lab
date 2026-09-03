import { SentimentAnalysisResult, SentimentAnalyzer } from "../domain/sentiment.entity";

export class LexiconSentimentAnalyzer implements SentimentAnalyzer {
  public readonly providerCode = "LEXICON_V1";
  public readonly providerName = "Rule-Based Lexicon Sentiment Analyzer";

  private positiveWords = new Set([
    // English positive crypto keywords (80+ words)
    "bullish", "surge", "surges", "surging", "pump", "pumps", "pumping", "gain", "gains", "gaining",
    "ath", "breakout", "skyrocket", "skyrockets", "skyrocketing", "rally", "rallies", "rallying",
    "inflow", "inflows", "soar", "soars", "soaring", "optimistic", "growth", "highs", "uptrend",
    "adoption", "partner", "partners", "partnership", "support", "sec", "approval", "approves", "approved",
    "etf", "etfs", "accumulate", "accumulation", "accumulating", "treasury", "invest", "investment",
    "investor", "investors", "buying", "buy", "buys", "profit", "profitable", "profits", "rewards",
    "staking", "airdrop", "airdrops", "halving", "mainnet", "upgrade", "upgrades", "upgraded",
    "launch", "launches", "launched", "milestone", "record", "records", "expansion", "expand",
    "listing", "listings", "listed", "green", "rebound", "rebounds", "rebounding", "recovery", "recover",
    "integration", "integrates", "integrated", "collaboration", "whitelist", "bounty", "dividend",

    // Vietnamese positive crypto keywords (30+ words/phrases)
    "tăng", "tăng trưởng", "tăng mạnh", "phá đỉnh", "vượt đỉnh", "đỉnh cao", "bứt phá", "lạc quan",
    "dòng tiền vào", "mua vào", "tích lũy", "hợp tác", "phê duyệt", "được duyệt", "đầu tư", "lợi nhuận",
    "phục hồi", "khởi sắc", "thắng lớn", "tiềm năng", "mở rộng", "niêm yết", "trả thưởng", "nâng cấp"
  ]);

  private negativeWords = new Set([
    // English negative crypto keywords (80+ words)
    "bearish", "crash", "crashes", "crashing", "dump", "dumps", "dumping", "drop", "drops", "dropping",
    "fall", "falls", "falling", "plunge", "plunges", "plunging", "fud", "scam", "scams", "hack", "hacks",
    "hacked", "hacker", "hackers", "loss", "losses", "risk", "risks", "ban", "bans", "banned", "banning",
    "lawsuit", "lawsuits", "downside", "liquidation", "liquidations", "liquidated", "downtrend", "panic",
    "collapse", "collapses", "collapsing", "investigation", "investigations", "investigating", "exploit",
    "exploits", "exploited", "rugpull", "rugpulled", "bankruptcy", "bankrupt", "insolvent", "insolvency",
    "vulnerability", "vulnerabilities", "fine", "fined", "fines", "penalty", "penalties", "crackdown",
    "prosecute", "prosecution", "subpoena", "delisting", "delisted", "delist", "selloff", "selloffs",
    "decline", "declines", "declining", "outflow", "outflows", "slump", "slumps", "slumping", "fear",

    // Vietnamese negative crypto keywords (30+ words/phrases)
    "giảm", "giảm mạnh", "sụt giảm", "sập", "sập sàn", "bị hack", "lừa đảo", "rủi ro", "thua lỗ",
    "bị cấm", "kiện tụng", "thanh lý", "xả hàng", "hoảng loạn", "phá sản", "vỡ nợ", "rút vốn",
    "dòng tiền ra", "bị phạt", "điều tra", "hủy niêm yết", "bán tháo", "lao dốc", "lo sợ"
  ]);

  public async analyzeText(text: string): Promise<SentimentAnalysisResult> {
    if (!text || text.trim().length === 0) {
      return { classification: "NEUTRAL", score: 0, confidence: 0.5 };
    }

    const cleanText = text.toLowerCase();

    // Support Unicode (English + Vietnamese) word extraction
    const words = cleanText.match(/[\p{L}\p{N}]+/gu) || [];
    let posCount = 0;
    let negCount = 0;

    // 1. Single word matching
    for (const word of words) {
      if (this.positiveWords.has(word)) posCount++;
      if (this.negativeWords.has(word)) negCount++;
    }

    // 2. Multi-word Vietnamese phrase matching
    for (const phrase of this.positiveWords) {
      if (phrase.includes(" ") && cleanText.includes(phrase)) {
        posCount += 1.5;
      }
    }
    for (const phrase of this.negativeWords) {
      if (phrase.includes(" ") && cleanText.includes(phrase)) {
        negCount += 1.5;
      }
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
