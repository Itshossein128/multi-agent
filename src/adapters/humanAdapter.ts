export interface HumanAdapter {
  type: "cli" | "mattermost";
  askHuman(question: string, context?: any): Promise<string>;
  notify(message: string): Promise<void>;
}

// CLI Implementation using readline/inquirer
import * as readline from "readline";

export class CLIHumanAdapter implements HumanAdapter {
  public type: "cli" = "cli";

  async askHuman(question: string, context?: any): Promise<string> {
    console.log(`\n================ HUMAN QUESTION ================`);
    if (context) {
      console.log(
        `Context: ${typeof context === "string" ? context : JSON.stringify(context, null, 2)}`,
      );
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
      rl.question("Your response > ", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  async notify(message: string): Promise<void> {
    console.log(`\n[AGENT NOTIFICATION]: ${message}\n`);
  }
}


// Mattermost Webhook / Bot Implementation
import axios from "axios";

export class MattermostHumanAdapter implements HumanAdapter {
  public type: "mattermost" = "mattermost";
  private webhookUrl: string;

  constructor(webhookUrl?: string) {
    this.webhookUrl =
      webhookUrl ||
      process.env.MATTERMOST_WEBHOOK_URL ||
      "http://localhost:8065/hooks/mock-hook";
  }

  async askHuman(question: string, context?: any): Promise<string> {
    const text = `### 🤖 Agent Question\n**Question**: ${question}\n${context ? `\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`` : ""}`;

    try {
      await axios.post(this.webhookUrl, { text });
      console.log(
        `[MattermostHumanAdapter] Sent question to Mattermost webhook: ${this.webhookUrl}`,
      );
    } catch (err: any) {
      console.warn(
        `[MattermostHumanAdapter] Failed to post to webhook: ${err.message}`,
      );
    }

    if (process.env.AUTO_ANSWER) {
      return process.env.AUTO_ANSWER;
    }

    return `Mattermost user response to: ${question}`;
  }

  async notify(message: string): Promise<void> {
    try {
      await axios.post(this.webhookUrl, {
        text: `📢 **Notification**: ${message}`,
      });
    } catch (err: any) {
      console.warn(
        `[MattermostHumanAdapter] Failed to notify webhook: ${err.message}`,
      );
    }
  }
}
