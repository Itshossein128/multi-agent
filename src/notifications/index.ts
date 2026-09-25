export type NotificationChannel = "webhook" | "email" | "in_app" | "custom";

export interface NotificationMessage {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  eventType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
  attempts: number;
  nextAttemptAt: string;
}

export interface NotificationSink {
  deliver(message: NotificationMessage): Promise<void>;
}

export interface NotificationOutbox {
  enqueue(message: NotificationMessage): Promise<boolean> | boolean;
  due(nowIso: string, limit: number): Promise<NotificationMessage[]> | NotificationMessage[];
  complete(id: string): Promise<void> | void;
  retry(id: string, attempts: number, nextAttemptAt: string): Promise<void> | void;
}

/** In-memory reference outbox; production adapters can persist the same contract. */
export class InMemoryNotificationOutbox implements NotificationOutbox {
  private readonly messages = new Map<string, NotificationMessage>();
  private readonly idempotency = new Set<string>();
  enqueue(message: NotificationMessage) {
    if (this.idempotency.has(message.idempotencyKey)) return false;
    this.idempotency.add(message.idempotencyKey);
    this.messages.set(message.id, structuredClone(message));
    return true;
  }
  due(now: string, limit: number) { return [...this.messages.values()].filter((message) => message.nextAttemptAt <= now).slice(0, limit).map((message) => structuredClone(message)); }
  complete(id: string) { this.messages.delete(id); }
  retry(id: string, attempts: number, nextAttemptAt: string) { const message = this.messages.get(id); if (message) Object.assign(message, { attempts, nextAttemptAt }); }
}

export class NotificationDispatcher {
  constructor(private readonly outbox: NotificationOutbox, private readonly sinks: ReadonlyMap<NotificationChannel, NotificationSink>, private readonly maxAttempts = 5) {}
  async publish(input: Omit<NotificationMessage, "attempts" | "nextAttemptAt">) {
    return this.outbox.enqueue({ ...input, attempts: 0, nextAttemptAt: input.createdAt });
  }
  async drain(now = new Date()) {
    const messages = await this.outbox.due(now.toISOString(), 100);
    let delivered = 0;
    for (const message of messages) {
      const sink = this.sinks.get(message.channel);
      try {
        if (!sink) throw new Error(`No notification sink configured for ${message.channel}`);
        await sink.deliver(message);
        await this.outbox.complete(message.id);
        delivered += 1;
      } catch {
        const attempts = message.attempts + 1;
        if (attempts >= this.maxAttempts) await this.outbox.complete(message.id);
        else await this.outbox.retry(message.id, attempts, new Date(now.getTime() + Math.min(60_000, 2 ** attempts * 1_000)).toISOString());
      }
    }
    return { seen: messages.length, delivered };
  }
}
