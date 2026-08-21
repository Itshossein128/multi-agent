import { WorkflowState } from './types';
import { BookStackClient } from '../integrations/bookstack';
import { HumanAdapter } from '../adapters/humanAdapter';

export class DocGeneratorAgent {
  private bookStackClient: BookStackClient;

  constructor(bookStackClient?: BookStackClient) {
    this.bookStackClient = bookStackClient || new BookStackClient();
  }

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

    // Decision logic on BookStack structure level
    let targetType: 'shelf' | 'book' | 'chapter' | 'page' = 'page';
    let targetId: number | undefined = undefined;

    const lowerInput = state.inputPrompt.toLowerCase();
    if (lowerInput.includes('entire system') || lowerInput.includes('platform') || lowerInput.includes('domain')) {
      targetType = 'shelf';
      const shelf = await this.bookStackClient.createShelf(docTitle, 'Top-level domain shelf created by DocGeneratorAgent');
      targetId = shelf.id;
    } else if (lowerInput.includes('architecture') || lowerInput.includes('app')) {
      targetType = 'book';
      const book = await this.bookStackClient.createBook(docTitle, 'System architecture book created by DocGeneratorAgent');
      targetId = book.id;
    } else if (lowerInput.includes('module') || lowerInput.includes('feature set')) {
      targetType = 'chapter';
      const chapter = await this.bookStackClient.createChapter(10, docTitle, 'Feature module chapter created by DocGeneratorAgent');
      targetId = chapter.id;
    } else {
      targetType = 'page';
      const page = await this.bookStackClient.createPage({ bookId: 10, name: docTitle, markdown: docContent });
      targetId = page.id;
    }

    await humanAdapter.notify(`DocGeneratorAgent completed: Created BookStack ${targetType} (ID: ${targetId}). Doc is now mature and ready for Orchestrator.`);

    return {
      isDoc: true,
      isMatureDoc: true,
      docTitle,
      docContent,
      bookStackTargetType: targetType,
      bookStackTargetId: targetId,
      createdDocUrl: `http://localhost:8080/${targetType}s/${targetId}`,
      status: 'READY_FOR_DEV',
    };
  }
}
