#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { CLIHumanAdapter, WebHumanAdapter, MattermostHumanAdapter } from '../adapters/humanAdapter';
import { AgentGraphEngine } from '../agents/graphEngine';

dotenv.config();

const program = new Command();

program
  .name('multi-agent')
  .description('Self-hosted Multi-Agent Platform for software development')
  .version('1.0.0');

program
  .command('start')
  .description('Run a workflow starting from the Orchestrator agent using CLI interface')
  .argument('<prompt>', 'Initial requirement prompt or document content')
  .action(async (prompt: string) => {
    console.log('\n🚀 Starting Multi-Agent Workflow Engine via CLI...\n');
    const adapter = new CLIHumanAdapter();
    const engine = new AgentGraphEngine();

    const result = await engine.runWorkflow({
      inputPrompt: prompt,
      humanAdapter: adapter,
    });

    console.log('\n================ WORKFLOW SUMMARY ================');
    console.log(`Final Status: ${result.status}`);
    console.log(`Document Title: ${result.docTitle || 'N/A'}`);
    if (result.createdDocUrl) console.log(`BookStack Document URL: ${result.createdDocUrl}`);
    if (result.createdWorkItemIds?.length) console.log(`Azure DevOps Work Item IDs: ${result.createdWorkItemIds.join(', ')}`);
    if (result.prUrl) console.log(`Azure DevOps Pull Request: ${result.prUrl}`);
    console.log('==================================================\n');
  });

program
  .command('web-server')
  .description('Run workflow engine listening on web server for human interactive input')
  .option('-p, --port <number>', 'Port for web server', '3000')
  .argument('<prompt>', 'Initial requirement prompt or document content')
  .action(async (prompt: string, options: { port: string }) => {
    const port = parseInt(options.port, 10);
    console.log(`\n🌐 Starting Multi-Agent Web Server Adapter on port ${port}...\n`);
    const adapter = new WebHumanAdapter(port);
    await adapter.startServer();

    const engine = new AgentGraphEngine();
    const workflowPromise = engine.runWorkflow({
      inputPrompt: prompt,
      humanAdapter: adapter,
    });

    const result = await workflowPromise;
    console.log('\n================ WORKFLOW SUMMARY ================');
    console.log(`Final Status: ${result.status}`);
    if (result.prUrl) console.log(`Azure DevOps PR: ${result.prUrl}`);
    console.log('==================================================\n');
  });

program
  .command('mattermost-bot')
  .description('Run workflow using Mattermost integration')
  .argument('<prompt>', 'Initial requirement prompt or document content')
  .action(async (prompt: string) => {
    console.log('\n💬 Starting Multi-Agent Workflow via Mattermost Adapter...\n');
    const adapter = new MattermostHumanAdapter();
    const engine = new AgentGraphEngine();

    const result = await engine.runWorkflow({
      inputPrompt: prompt,
      humanAdapter: adapter,
    });

    console.log(`Workflow completed with status: ${result.status}`);
  });

program.parse(process.argv);
