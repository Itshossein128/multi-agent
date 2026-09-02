import { Langfuse } from 'langfuse';

export interface LangFuseConfig {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
}

export class LangFuseTracer {
  private client?: Langfuse;
  public isEnabled: boolean = false;

  constructor(config?: LangFuseConfig) {
    const publicKey = config?.publicKey || process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = config?.secretKey || process.env.LANGFUSE_SECRET_KEY;
    const baseUrl = config?.baseUrl || process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com';

    if (publicKey && secretKey) {
      this.client = new Langfuse({
        publicKey,
        secretKey,
        baseUrl,
      });
      this.isEnabled = true;
      console.log(`[LangFuse] Initialized tracing client against ${baseUrl}`);
    } else {
      console.log('[LangFuse] Credentials not provided; tracing operates in mock mode.');
    }
  }

  async traceExecution(name: string, input: any, output: any, metadata?: Record<string, any>): Promise<string> {
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    if (this.isEnabled && this.client) {
      try {
        const trace = this.client.trace({
          id: traceId,
          name,
          input,
          output,
          metadata,
        });
        await this.client.flushAsync();
        return trace.id;
      } catch (err: any) {
        console.warn(`[LangFuse] Error logging trace: ${err.message}`);
      }
    } else {
      console.log(`[LangFuse Mock Trace] Name: "${name}" | TraceID: ${traceId}`);
    }
    return traceId;
  }

  async flush(): Promise<void> {
    if (this.client) {
      await this.client.flushAsync();
    }
  }
}
