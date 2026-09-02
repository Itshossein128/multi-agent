import { getLLM } from "../core/llmFactory";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export interface DocumentEvaluator {
  evaluate(prompt: string): Promise<{ isDoc: boolean; isMatureDoc: boolean; reasons: string[] }>;
}

export class LLMDocumentEvaluator implements DocumentEvaluator {
  async evaluate(prompt: string): Promise<{ isDoc: boolean; isMatureDoc: boolean; reasons: string[] }> {
    const isDocCandidate =
      prompt.length > 50 ||
      prompt.includes("#") ||
      prompt.toLowerCase().includes("specification") ||
      prompt.toLowerCase().includes("doc");

    if (!isDocCandidate) {
      return {
        isDoc: false,
        isMatureDoc: false,
        reasons: ["Input is too short or informal to be considered a software spec documentation."],
      };
    }

    const llm = getLLM();
    const evaluationPrompt = `
You are an expert technical architect. Evaluate the following software requirement prompt.
Does it contain mature, sufficient details regarding:
1. Technology Stack
2. System Architecture / Components
3. Feature / User Requirements

Respond with a JSON object ONLY, in this exact format:
{
  "isMatureDoc": boolean,
  "reasons": [] // If not mature, list specifically what is missing as short sentences. If mature, empty array.
}

Prompt to evaluate:
---
${prompt}
---`;

    try {
      const response = await llm.invoke([
        new SystemMessage("You are a technical document maturity analyzer."),
        new HumanMessage(evaluationPrompt),
      ]);

      const text = response.content
        .toString()
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      const parsed = JSON.parse(text);

      return {
        isDoc: true,
        isMatureDoc: Boolean(parsed.isMatureDoc),
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
      };
    } catch (error) {
      console.warn("LLM document maturity evaluation failed, falling back to assuming immature.", error);
      return {
        isDoc: true,
        isMatureDoc: false,
        reasons: ["Document evaluation failed, system assumes missing details."],
      };
    }
  }
}
