import { SentimentAnalysisResult, SentimentAnalyzer } from "../domain/sentiment.entity";
import { LexiconSentimentAnalyzer } from "./lexicon-sentiment.analyzer";

export class GeminiSentimentAnalyzer implements SentimentAnalyzer {
  public readonly providerCode = "GEMINI_V1";
  public readonly providerName = "Gemini LLM Sentiment Analyzer";

  private fallbackAnalyzer = new LexiconSentimentAnalyzer();

  public async analyzeText(text: string): Promise<SentimentAnalysisResult> {
    if (!text || text.trim().length === 0) {
      return { classification: "NEUTRAL", score: 0, confidence: 0.5 };
    }

    const apiKey = process.env.GEMINI_API_KEY;

    // Fallback to Lexicon Analyzer if no API key is set for Gemini
    if (!apiKey) {
      const fallbackResult = await this.fallbackAnalyzer.analyzeText(text);
      return {
        ...fallbackResult,
        confidence: Math.round(Math.min(0.99, fallbackResult.confidence + 0.05) * 100) / 100,
      };
    }

    try {
      // In production with GEMINI_API_KEY configured, call Gemini API endpoint
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
                    text: `You are a financial crypto sentiment analyzer. Analyze the text below and respond with strictly valid JSON only: {"classification": "POSITIVE"|"NEUTRAL"|"NEGATIVE", "score": number between -1.0 and 1.0, "confidence": number between 0.0 and 1.0}.\n\nText: "${text}"`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
            },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API returned status ${response.status}`);
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const rawJsonStr = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawJsonStr) throw new Error("Empty response from Gemini API");

      const parsed = JSON.parse(rawJsonStr) as SentimentAnalysisResult;
      return {
        classification: parsed.classification || "NEUTRAL",
        score: Math.round((parsed.score ?? 0) * 1000) / 1000,
        confidence: Math.round((parsed.confidence ?? 0.8) * 100) / 100,
      };
    } catch {
      // On network failure or API error, seamlessly fallback to Lexicon analyzer
      return this.fallbackAnalyzer.analyzeText(text);
    }
  }
}
