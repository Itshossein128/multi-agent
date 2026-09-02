import { WorkflowState } from './types';
import { HumanAdapter } from '../adapters/humanAdapter';

export class DocGeneratorAgent {
  constructor() {}

  async run(state: WorkflowState, humanAdapter: HumanAdapter): Promise<Partial<WorkflowState>> {
    await humanAdapter.notify('DocGeneratorAgent starting: Transforming amateur input into a mature technical spec...');

    // Ask clarifying questions to build mature documentation
    const q1 = 'What are the target architecture, key tech stack, and non-functional requirements (e.g. performance, security) for this project?';
    const ans1 = await humanAdapter.askHuman(q1, { initialInput: state.inputPrompt });

    const q2 = 'What are the main user roles, database schema specifications, and primary API endpoints required?';
    const ans2 = await humanAdapter.askHuman(q2);

    const docTitle = `Technical Specification: ${state.inputPrompt.slice(0, 40).replace(/[^a-zA-Z0-9 ]/g, '') || 'System Software'}`;
    const docContent = `
# ${docTitle}

## 1. Overview & Goals
${state.inputPrompt}

## 2. Technical Architecture & Tech Stack
${ans1}

## 3. Data Schema & Core API Endpoints
${ans2}

## 4. Security & Performance Requirements
- Authentication: OAuth2 / JWT
- Data Encryption at rest and in transit
- Auto-scaling supported
`;

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
