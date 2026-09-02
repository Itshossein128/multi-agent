export interface DocumentFormatter {
  format(title: string, prompt: string, answers: string[]): string;
}

export class MarkdownDocumentFormatter implements DocumentFormatter {
  format(title: string, prompt: string, answers: string[]): string {
    return `
# ${title}

## 1. Overview & Goals
${prompt}

## 2. Technical Architecture & Tech Stack
${answers[0] || ''}

## 3. Data Schema & Core API Endpoints
${answers[1] || ''}

## 4. Security & Performance Requirements
- Authentication: OAuth2 / JWT
- Data Encryption at rest and in transit
- Auto-scaling supported
`;
  }
}
