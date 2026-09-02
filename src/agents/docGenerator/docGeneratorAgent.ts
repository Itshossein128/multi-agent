import { WorkflowState, Agent } from "../core/types";
import { HumanAdapter } from "../../adapters/humanAdapter";
import { DocumentFormatter, MarkdownDocumentFormatter } from "./documentFormatter";

export class DocGeneratorAgent implements Agent {
  private formatter: DocumentFormatter;

  constructor(formatter?: DocumentFormatter) {
    this.formatter = formatter || new MarkdownDocumentFormatter();
  }

  async run(state: WorkflowState, humanAdapter: HumanAdapter): Promise<Partial<WorkflowState>> {
    await humanAdapter.notify('DocGeneratorAgent starting: Transforming amateur input into a mature technical spec...');

    const q1 = 'What are the target architecture, key tech stack, and non-functional requirements (e.g. performance, security) for this project?';
    const ans1 = await humanAdapter.askHuman(q1, { initialInput: state.inputPrompt });

    const q2 = 'What are the main user roles, database schema specifications, and primary API endpoints required?';
    const ans2 = await humanAdapter.askHuman(q2);

    const docTitle = `Technical Specification: ${state.inputPrompt.slice(0, 40).replace(/[^a-zA-Z0-9 ]/g, '') || 'System Software'}`;
    const docContent = this.formatter.format(docTitle, state.inputPrompt, [ans1, ans2]);

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
