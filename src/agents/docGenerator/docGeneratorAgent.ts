import { WorkflowState, Agent } from "../core/types";
import { HumanAdapter } from "../../adapters/humanAdapter";
import { DocumentFormatter, MarkdownDocumentFormatter } from "./documentFormatter";
import { getLLM } from "../core/llmFactory";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export class DocGeneratorAgent implements Agent {
  private formatter: DocumentFormatter;

  constructor(formatter?: DocumentFormatter) {
    this.formatter = formatter || new MarkdownDocumentFormatter();
  }

  private async generateClarificationQuestions(
    prompt: string,
    reasons?: string[],
    mode?: string,
    targetRepo?: string,
  ): Promise<string[]> {
    const llm = getLLM();
    let modeContext = "The user is specifying a software component.";
    let userContext = `Software requirement to clarify:\n"${prompt}"`;

    if (mode === "CONTINUATION") {
      modeContext = `The user is continuing or extending an existing project ("${targetRepo || "current repository"}").`;
      userContext = `Existing project feature addition:\n"${prompt}"\nAsk questions focusing on integration with existing components, API conventions, or database updates.`;
    } else if (mode === "DEBUG") {
      modeContext = `The user is reporting an error or debugging an existing project ("${targetRepo || "current repository"}").`;
      userContext = `Bug / Issue to resolve:\n"${prompt}"\nAsk questions focusing on error symptoms, reproduction steps, or expected behavior.`;
    }

    const systemPrompt = `You are an expert software architect and technical lead.
${modeContext}
Generate 1 or 2 targeted, open-ended technical clarification questions to help write a production-ready specification. Focus strictly on any ambiguities or missing details.

Respond ONLY with a JSON object in this format:
{
  "questions": [
    "Question 1...",
    "Question 2..."
  ]
}`;

    try {
      const response = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`${userContext}${reasons?.length ? `\nMissing details identified: ${reasons.join('; ')}` : ''}`),
      ]);

      const text = response.content
        .toString()
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      const parsed = JSON.parse(text);
      if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        return parsed.questions.slice(0, 2);
      }
    } catch (err: any) {
      console.warn("LLM dynamic question generation failed.", err.message);
    }

    if (reasons && reasons.length > 0) {
      return reasons.slice(0, 2).map((r) => `Regarding "${prompt.trim()}": ${r.replace(/\.$/, '')}. Could you clarify?`);
    }

    return [
      `Could you provide the technical stack, architecture, and functional specifications for "${prompt.trim()}"?`
    ];
  }

  async run(state: WorkflowState, humanAdapter: HumanAdapter): Promise<Partial<WorkflowState>> {
    await humanAdapter.notify('DocGeneratorAgent starting: Transforming amateur input into a mature technical spec...');

    const questions = await this.generateClarificationQuestions(
      state.inputPrompt,
      state.docEvaluationReasons,
      state.projectMode,
      state.targetRepo,
    );

    const answers: string[] = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const ans = await humanAdapter.askHuman(q, {
        questionIndex: i + 1,
        totalQuestions: questions.length,
        initialInput: i === 0 ? state.inputPrompt : undefined,
      });
      answers.push(ans);
    }

    const docTitle = `Technical Specification: ${state.inputPrompt.slice(0, 40).replace(/[^a-zA-Z0-9 ]/g, '') || 'System Software'}`;
    const docContent = this.formatter.format(docTitle, state.inputPrompt, answers, questions);

    await humanAdapter.notify(`DocGeneratorAgent completed: Created mature documentation.`);

    return {
      isDoc: true,
      isMatureDoc: true,
      docTitle,
      docContent,
      createdDocUrl: '#',
      status: 'READY_FOR_DEV',
    };
  }
}
