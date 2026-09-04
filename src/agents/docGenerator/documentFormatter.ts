export interface DocumentFormatter {
  format(title: string, prompt: string, answers: string[], questions?: string[]): string;
}

export class MarkdownDocumentFormatter implements DocumentFormatter {
  format(title: string, prompt: string, answers: string[], questions?: string[]): string {
    const qSection = questions && questions.length > 0
      ? questions.map((q, idx) => `### Clarification: ${q}\n${answers[idx] || 'Not specified'}\n`).join('\n')
      : `## 2. Technical Architecture & Tech Stack\n${answers[0] || ''}\n\n## 3. Data Schema & Core API Endpoints\n${answers[1] || ''}`;

    return `
# ${title}

## 1. Overview & Goals
${prompt}

## 2. Requirements & Technical Architecture
${qSection}

## 3. Security & Non-Functional Requirements
- Authentication: OAuth2 / JWT
- Data Encryption at rest and in transit
- Auto-scaling supported
`;
  }
}
