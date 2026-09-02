import { getLLM } from "../core/llmFactory";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export interface CodeGenerator {
  generateCode(spec: string): Promise<string>;
}

export class LLMCodeGenerator implements CodeGenerator {
  async generateCode(spec: string): Promise<string> {
    const llm = getLLM();
    try {
      const response = await llm.invoke([
        new SystemMessage(
          "You are an expert software developer agent. Write the main code or an implementation plan for the requested feature based on the spec. Provide your response clearly formatted.",
        ),
        new HumanMessage(
          `Please implement this feature based on the following spec:\n\n${spec}`,
        ),
      ]);
      return response.content.toString();
    } catch (err: any) {
      console.warn("LLM generation failed", err);
      return "_LLM generation failed or was bypassed. Mock implementation._";
    }
  }
}
