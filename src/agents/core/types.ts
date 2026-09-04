import { BaseMessage } from '@langchain/core/messages';
import { HumanAdapter } from '../../adapters/humanAdapter';

export type ProjectMode = 'NEW_PROJECT' | 'CONTINUATION' | 'DEBUG';
export type VcsMode = 'API' | 'CLONE';

export interface WorkflowState {
  messages: BaseMessage[];
  inputPrompt: string;
  projectMode?: ProjectMode;
  vcsMode?: VcsMode;
  workspacePath?: string;
  isDoc: boolean;
  isMatureDoc: boolean;
  docTitle?: string;
  docContent?: string;
  createdDocUrl?: string;
  tasks?: Array<{ title: string; description: string; type: 'Task' | 'User Story' | 'Bug' }>;
  createdWorkItemIds?: number[];
  targetRepo?: string;
  targetFile?: string;
  existingCodeContext?: string;
  docEvaluationReasons?: string[];
  prUrl?: string;
  humanAdapter?: HumanAdapter;
  status: 'PENDING' | 'QUESTIONS_NEEDED' | 'DOC_GENERATING' | 'READY_FOR_DEV' | 'DEV_IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  clarificationQuestions?: string[];
  humanAnswers?: Record<string, string>;
}

export interface Agent {
  run(state: WorkflowState, humanAdapter: HumanAdapter): Promise<Partial<WorkflowState>>;
}
