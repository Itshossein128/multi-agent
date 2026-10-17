import { createAgentRecord } from '@multi-agent/types';
import { DefaultContextAssembler } from '../src/agents/runtime/contextAssembler';
import { CliAgentExecutor } from '../src/agents/runtime/cliAgentExecutor';
import type { WorkerRuntime } from '../src/agents/runtime/workerRuntime';

test('CLI handoffs preserve original requirements even when optional runtime state exceeds the budget', async () => {
  const agent = createAgentRecord({ backend: { type: 'cli', provider: 'codex' } });
  agent.executionPolicy = { shell: 'restricted', filesystem: 'read', workspaceRoot: '/workspace', allowedCommands: ['codex'] };
  const original = { repository: '/workspace', acceptance: 'Fix all eight findings, including budget settlement' };
  const assembledContext = await new DefaultContextAssembler({ defaultInputBudget: 50 }).assemble({
    runId: 'run', workflowId: 'workflow', nodeId: 'verify', agentId: agent.id, agent,
    task: 'The previous agent only reported the authentication fix.',
    runtimeState: { workflowInput: original, nodeResults: { huge: 'x'.repeat(10000) } },
  });
  const start = jest.fn(async (..._args: unknown[]) => ({ workerId: 'worker', runId: 'run' }));
  const worker = { start, wait: async () => ({ code: 0, stdout: 'verified', stderr: '', reason: 'completed' }), cleanup: async () => {} } as unknown as WorkerRuntime;
  const executor = new CliAgentExecutor(worker, { enabled: true, workerMode: 'local', allowedExecutables: ['codex'], workspaceRoots: ['/workspace'], maxOutputBytes: 1024 });
  for await (const _ of executor.execute({ agent, runId: 'run', nodeId: 'verify', input: 'previous output', assembledContext })) {}
  const prompt = start.mock.calls[0][2] as string;
  expect(prompt).toContain('ORIGINAL WORKFLOW INPUT:');
  expect(prompt).toContain(JSON.stringify(original));
  expect(prompt).toContain('The previous agent only reported the authentication fix.');
  expect(prompt).not.toContain('x'.repeat(100));
});

test('CLI failures retain the terminal diagnostic after a long startup banner and prompt', async () => {
  const agent = createAgentRecord({ backend: { type: 'cli', provider: 'codex' } });
  agent.executionPolicy = { shell: 'restricted', filesystem: 'read', workspaceRoot: '/workspace', allowedCommands: ['codex'] };
  const worker = { start: async () => ({ workerId: 'worker', runId: 'run' }),
    wait: async () => ({ code: 1, stdout: '', stderr: 'Startup banner and prompt\n'.repeat(200) + '\nYou have hit your usage limit.', reason: 'failed' }),
    cleanup: async () => {} } as unknown as WorkerRuntime;
  const executor = new CliAgentExecutor(worker, { enabled: true, workerMode: 'local', allowedExecutables: ['codex'], workspaceRoots: ['/workspace'], maxOutputBytes: 10000 });
  await expect((async () => {
    for await (const _ of executor.execute({ agent, runId: 'run', nodeId: 'implement', input: 'task' })) {}
  })()).rejects.toThrow('You have hit your usage limit.');
});
