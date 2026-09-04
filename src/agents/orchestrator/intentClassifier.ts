import { getLLM } from '../core/llmFactory';
import { ProjectMode } from '../core/types';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export interface ClassifiedIntent {
  mode: ProjectMode;
  targetRepo?: string;
  targetFile?: string;
  summary: string;
}

export interface IntentClassifier {
  classify(prompt: string, availableRepos: string[]): Promise<ClassifiedIntent>;
}

export class LLMIntentClassifier implements IntentClassifier {
  async classify(prompt: string, availableRepos: string[]): Promise<ClassifiedIntent> {
    const llm = getLLM();
    const systemPrompt = `You are an expert AI software architect and triage lead.
Analyze the user's request and determine the lifecycle mode:
- "NEW_PROJECT": Creating a brand new application, module, or repository from scratch.
- "CONTINUATION": Adding a feature, extending functionality, or refactoring an EXISTING codebase.
- "DEBUG": Fixing a bug, resolving an error/exception, debugging, or troubleshooting existing code.

Available repositories in user workspace:
${JSON.stringify(availableRepos)}

Extract:
1. "mode": "NEW_PROJECT" | "CONTINUATION" | "DEBUG"
2. "targetRepo": the repository name that matches the request best (or null if new/unspecified)
3. "targetFile": specific file path mentioned or affected (or null if not specified)
4. "summary": 1 sentence summary of the engineering goal

Respond ONLY with a JSON object:
{
  "mode": "NEW_PROJECT" | "CONTINUATION" | "DEBUG",
  "targetRepo": string | null,
  "targetFile": string | null,
  "summary": string
}`;

    try {
      const response = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`User prompt to triage:\n"${prompt}"`),
      ]);

      const text = response.content
        .toString()
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

      const parsed = JSON.parse(text);
      let mode: ProjectMode = 'NEW_PROJECT';
      if (parsed.mode === 'DEBUG' || parsed.mode === 'CONTINUATION') {
        mode = parsed.mode;
      }

      // Match targetRepo to available repos if possible
      let targetRepo: string | undefined = undefined;
      if (parsed.targetRepo && typeof parsed.targetRepo === 'string' && parsed.targetRepo !== 'null') {
        const match = availableRepos.find(
          (r) => r.toLowerCase() === parsed.targetRepo.toLowerCase()
        );
        targetRepo = match || parsed.targetRepo;
      }

      return {
        mode,
        targetRepo,
        targetFile: parsed.targetFile && parsed.targetFile !== 'null' ? parsed.targetFile : undefined,
        summary: parsed.summary || prompt.slice(0, 80),
      };
    } catch (err: any) {
      console.warn('LLM intent triage failed, applying heuristic classification.', err.message);
      return this.heuristicClassify(prompt, availableRepos);
    }
  }

  private heuristicClassify(prompt: string, availableRepos: string[]): ClassifiedIntent {
    const p = prompt.toLowerCase();
    
    // Check if an existing repo is mentioned
    const matchedRepo = availableRepos.find((repo) => p.includes(repo.toLowerCase()));

    // Check for debug/bugfix keywords
    const isDebug = /fix|bug|error|broken|failing|crash|exception|resolve issue|debug|regression|500|404|segfault/i.test(p);
    if (isDebug) {
      return {
        mode: 'DEBUG',
        targetRepo: matchedRepo || availableRepos[0],
        summary: prompt.slice(0, 80),
      };
    }

    // Check for continuation keywords or existing repo reference
    const isContinuation = Boolean(matchedRepo) || /continue|extend|add .* to|refactor|update .* in|integrate into|feature on existing/i.test(p);
    if (isContinuation) {
      return {
        mode: 'CONTINUATION',
        targetRepo: matchedRepo || availableRepos[0],
        summary: prompt.slice(0, 80),
      };
    }

    return {
      mode: 'NEW_PROJECT',
      targetRepo: matchedRepo,
      summary: prompt.slice(0, 80),
    };
  }
}
