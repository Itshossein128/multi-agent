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
import axios, { AxiosInstance } from "axios";

export interface MattermostAdapterConfig {
  webhookUrl?: string;
  botToken?: string;
  channelId?: string;
  serverUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export class MattermostHumanAdapter implements HumanAdapter {
  public type: "mattermost" = "mattermost";
  private webhookUrl: string;
  private botToken?: string;
  private channelId?: string;
  private serverUrl: string;
  private pollIntervalMs: number;
  private timeoutMs: number;
  private botClient?: AxiosInstance;
  public botUserId?: string;
  private isListening: boolean = false;

  constructor(config?: MattermostAdapterConfig | string) {
    if (typeof config === "string") {
      this.webhookUrl = config;
      this.botToken = process.env.MATTERMOST_BOT_TOKEN;
      this.channelId = process.env.MATTERMOST_CHANNEL_ID;
      this.serverUrl = process.env.MATTERMOST_SERVER_URL || "http://localhost:8065";
      this.pollIntervalMs = 2500;
      this.timeoutMs = 120000;
    } else {
      this.webhookUrl =
        config?.webhookUrl ||
        process.env.MATTERMOST_WEBHOOK_URL ||
        "http://localhost:8065/hooks/mock-hook";
      this.botToken = config?.botToken || process.env.MATTERMOST_BOT_TOKEN;
      this.channelId = config?.channelId || process.env.MATTERMOST_CHANNEL_ID;
      this.serverUrl =
        config?.serverUrl ||
        process.env.MATTERMOST_SERVER_URL ||
        "http://localhost:8065";
      this.pollIntervalMs = config?.pollIntervalMs || 2500;
      this.timeoutMs = config?.timeoutMs || 120000; // 2 minutes default timeout
    }

    if (this.botToken) {
      this.botClient = axios.create({
        baseURL: `${this.serverUrl.replace(/\/$/, "")}/api/v4`,
        headers: {
          Authorization: `Bearer ${this.botToken}`,
          "Content-Type": "application/json",
        },
      });
    }
  }

  async initBotUser(): Promise<string | undefined> {
    if (this.botUserId) return this.botUserId;
    if (!this.botClient) return undefined;
    try {
      const meRes = await this.botClient.get("/users/me");
      this.botUserId = meRes.data.id;
      return this.botUserId;
    } catch {
      return undefined;
    }
  }

  stopListener(): void {
    this.isListening = false;
  }

  async startListenerLoop(
    handler: (prompt: string, adapter: MattermostHumanAdapter) => Promise<void>,
    once: boolean = false
  ): Promise<void> {
    if (!this.botClient || !this.channelId) {
      throw new Error(
        "[Mattermost Bot] Error: MATTERMOST_BOT_TOKEN and MATTERMOST_CHANNEL_ID must be configured in .env."
      );
    }

    await this.initBotUser();

    let channelName = this.channelId;
    try {
      const chRes = await this.botClient.get(`/channels/${this.channelId}`);
      channelName = `${chRes.data.display_name} (#${chRes.data.name})`;
    } catch {
      // fallback
    }

    console.log(`\n======================================================`);
    console.log(`🤖 Multi-Agent Mattermost Bot Daemon Started`);
    console.log(`📡 Connected Channel: ${channelName}`);
    console.log(`👂 Listening for user messages inside Mattermost...`);
    console.log(`======================================================\n`);

    await this.notify(
      `🤖 **Multi-Agent Bot is online and listening!**\nSend any software requirement, feature request, or bug report here to trigger an automated workflow.`
    );

    let lastTimestamp = Date.now();
    this.isListening = true;

    const onSigint = () => {
      console.log(`\n🛑 Shutting down Mattermost Bot listener...`);
      this.isListening = false;
      process.removeListener("SIGINT", onSigint);
    };
    process.on("SIGINT", onSigint);

    let isRunningWorkflow = false;

    while (this.isListening) {
      try {
        if (!isRunningWorkflow) {
          const response = await this.botClient.get(
            `/channels/${this.channelId}/posts?since=${lastTimestamp}`
          );
          const { posts, order } = response.data;

          if (order && order.length > 0) {
            const chronological = [...order].reverse();

            for (const postId of chronological) {
              const post = posts[postId];
              if (!post) continue;

              if (post.create_at > lastTimestamp) {
                lastTimestamp = post.create_at;
              }

              const isWebhook = post.props?.from_webhook === "true";
              const isBot =
                post.props?.from_bot === "true" ||
                (this.botUserId && post.user_id === this.botUserId);
              const isSystem = post.type?.startsWith("system_");

              if (
                !isWebhook &&
                !isBot &&
                !isSystem &&
                post.message &&
                post.message.trim().length > 0
              ) {
                const userPrompt = post.message.trim();
                console.log(`\n📥 [Mattermost User Message]: "${userPrompt}"`);

                isRunningWorkflow = true;
                await this.notify(
                  `🚀 **Workflow Triggered!**\n> "${userPrompt}"\n\nStarting multi-agent software engineering process...`
                );

                try {
                  await handler(userPrompt, this);
                } catch (err: any) {
                  console.error(`[Mattermost Bot] Workflow failed: ${err.message}`);
                  await this.notify(`❌ **Workflow Error**: ${err.message}`);
                } finally {
                  lastTimestamp = Date.now();
                  isRunningWorkflow = false;
                  console.log(`\n👂 Resumed listening for incoming messages in Mattermost channel...\n`);
                }

                if (once) {
                  this.isListening = false;
                }
                break; // Process one trigger at a time
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Mattermost Bot] Polling error: ${err.message}`);
      }

      if (this.isListening) {
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }
    }
  }

  async askHuman(question: string, context?: any): Promise<string> {
    const text = `### 🤖 Agent Question\n**Question**: ${question}\n${
      context ? `\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`` : ""
    }\n*👉 Please reply to this channel or thread with your answer.*`;

    const questionSentTime = Date.now();

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
      console.log(`[Mattermost Auto-Answer]: ${process.env.AUTO_ANSWER}`);
      return process.env.AUTO_ANSWER;
    }

    // If bot token and channel ID are available, wait for human reply from Mattermost channel
    if (this.botClient && this.channelId) {
      await this.initBotUser();
      console.log(
        `[MattermostHumanAdapter] Waiting for user response in channel (${this.channelId})...`,
      );
      const answer = await this.waitForUserResponse(questionSentTime);
      if (answer) {
        console.log(`[MattermostHumanAdapter] Received response: ${answer}`);
        return answer;
      }
    }

    return `Mattermost user response to: ${question}`;
  }

  private async waitForUserResponse(sinceTimestamp: number): Promise<string | null> {
    if (!this.botClient || !this.channelId) return null;

    const startTime = Date.now();

    while (Date.now() - startTime < this.timeoutMs) {
      try {
        const response = await this.botClient.get(
          `/channels/${this.channelId}/posts?since=${sinceTimestamp}`,
        );
        const { posts, order } = response.data;

        if (order && order.length > 0) {
          for (const postId of order) {
            const post = posts[postId];
            // Ignore bot's own posts and system webhook messages
            const isWebhook = post.props?.from_webhook === "true";
            const isBot =
              post.props?.from_bot === "true" ||
              (this.botUserId && post.user_id === this.botUserId);
            const isSystem = post.type?.startsWith("system_");

            if (!isWebhook && !isBot && !isSystem && post.message && post.create_at > sinceTimestamp) {
              const reply = post.message.trim();
              if (reply) {
                return reply;
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(`[MattermostHumanAdapter] Error polling posts: ${err.message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    console.warn(`[MattermostHumanAdapter] Timed out waiting for human reply after ${this.timeoutMs / 1000}s`);
    return null;
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
