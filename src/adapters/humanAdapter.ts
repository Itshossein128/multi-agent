export interface HumanAdapter {
  type: 'cli' | 'web' | 'mattermost';
  askHuman(question: string, context?: any): Promise<string>;
  notify(message: string): Promise<void>;
}

// CLI Implementation using readline/inquirer
import * as readline from 'readline';

export class CLIHumanAdapter implements HumanAdapter {
  public type: 'cli' = 'cli';

  async askHuman(question: string, context?: any): Promise<string> {
    console.log(`\n================ HUMAN QUESTION ================`);
    if (context) {
      console.log(`Context: ${typeof context === 'string' ? context : JSON.stringify(context, null, 2)}`);
    }
    console.log(`Question: ${question}`);
    console.log(`================================================\n`);

    // In non-interactive test/automated environments, if input stream is not a TTY or automated responses set:
    if (process.env.AUTO_ANSWER) {
      console.log(`[CLI Auto-Answer]: ${process.env.AUTO_ANSWER}`);
      return process.env.AUTO_ANSWER;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question('Your response > ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  async notify(message: string): Promise<void> {
    console.log(`\n[AGENT NOTIFICATION]: ${message}\n`);
  }
}

// Web Server / HTTP Endpoint Implementation
import express, { Express, Request, Response } from 'express';

export class WebHumanAdapter implements HumanAdapter {
  public type: 'web' = 'web';
  private app: Express;
  private server: any;
  private pendingQuestions: Map<string, { question: string; context?: any; resolve: (val: string) => void }> = new Map();
  private port: number;

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes() {
    // Get active question needing answer
    this.app.get('/api/questions', (req: Request, res: Response) => {
      const list = Array.from(this.pendingQuestions.entries()).map(([id, q]) => ({
        id,
        question: q.question,
        context: q.context,
      }));
      res.json({ questions: list });
    });

    // Answer a pending question
    this.app.post('/api/questions/:id/answer', (req: Request, res: Response) => {
      const { id } = req.params;
      const { answer } = req.body;
      const pending = this.pendingQuestions.get(id);

      if (!pending) {
        return res.status(404).json({ error: 'Question not found or already answered.' });
      }

      pending.resolve(answer);
      this.pendingQuestions.delete(id);
      res.json({ success: true, message: 'Answer recorded.' });
    });
  }

  public startServer(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`[WebHumanAdapter] Express server running on port ${this.port}`);
        resolve();
      });
    });
  }

  public stopServer(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  async askHuman(question: string, context?: any): Promise<string> {
    const qId = `q-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    console.log(`[WebHumanAdapter] Question posted to web endpoint (ID: ${qId}): ${question}`);

    if (process.env.AUTO_ANSWER) {
      return process.env.AUTO_ANSWER;
    }

    return new Promise((resolve) => {
      this.pendingQuestions.set(qId, { question, context, resolve });
    });
  }

  async notify(message: string): Promise<void> {
    console.log(`[WebHumanAdapter Notification]: ${message}`);
  }
}

// Mattermost Webhook / Bot Implementation
import axios from 'axios';

export class MattermostHumanAdapter implements HumanAdapter {
  public type: 'mattermost' = 'mattermost';
  private webhookUrl: string;

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl || process.env.MATTERMOST_WEBHOOK_URL || 'http://localhost:8065/hooks/mock-hook';
  }

  async askHuman(question: string, context?: any): Promise<string> {
    const text = `### 🤖 Agent Question\n**Question**: ${question}\n${context ? `\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`` : ''}`;

    try {
      await axios.post(this.webhookUrl, { text });
      console.log(`[MattermostHumanAdapter] Sent question to Mattermost webhook: ${this.webhookUrl}`);
    } catch (err: any) {
      console.warn(`[MattermostHumanAdapter] Failed to post to webhook: ${err.message}`);
    }

    if (process.env.AUTO_ANSWER) {
      return process.env.AUTO_ANSWER;
    }

    return `Mattermost user response to: ${question}`;
  }

  async notify(message: string): Promise<void> {
    try {
      await axios.post(this.webhookUrl, { text: `📢 **Notification**: ${message}` });
    } catch (err: any) {
      console.warn(`[MattermostHumanAdapter] Failed to notify webhook: ${err.message}`);
    }
  }
}
