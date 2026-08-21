import { BaseMessage } from '@langchain/core/messages';
import { HumanAdapter } from '../adapters/humanAdapter';

export interface WorkflowState {
  messages: BaseMessage[];
  inputPrompt: string;
  isDoc: boolean;
  isMatureDoc: boolean;
  docTitle?: string;
  docContent?: string;
  bookStackTargetType?: 'shelf' | 'book' | 'chapter' | 'page';
  bookStackTargetId?: number;
  createdDocUrl?: string;
  tasks?: Array<{ title: string; description: string; type: 'Task' | 'User Story' }>;
  createdWorkItemIds?: number[];
  prUrl?: string;
  humanAdapter?: HumanAdapter;
  status: 'PENDING' | 'QUESTIONS_NEEDED' | 'DOC_GENERATING' | 'READY_FOR_DEV' | 'DEV_IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  clarificationQuestions?: string[];
  humanAnswers?: Record<string, string>;
}
