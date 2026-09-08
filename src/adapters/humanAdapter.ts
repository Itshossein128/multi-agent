export interface HumanAdapter {
  type: "cli" | "web";
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
