#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { CLIHumanAdapter, MattermostHumanAdapter } from '../adapters/humanAdapter';
import { AgentGraphEngine } from '../agents/core/graphEngine';

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
    if (result.createdWorkItemIds?.length) console.log(`GitHub Issue IDs: ${result.createdWorkItemIds.join(', ')}`);
    if (result.prUrl) console.log(`GitHub Pull Request: ${result.prUrl}`);
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

    console.log('\n================ WORKFLOW SUMMARY ================');
    console.log(`Final Status: ${result.status}`);
    console.log(`Document Title: ${result.docTitle || 'N/A'}`);
    if (result.createdDocUrl) console.log(`BookStack Document URL: ${result.createdDocUrl}`);
    if (result.createdWorkItemIds?.length) console.log(`GitHub Issue IDs: ${result.createdWorkItemIds.join(', ')}`);
    if (result.prUrl) console.log(`GitHub Pull Request: ${result.prUrl}`);
    console.log('==================================================\n');

    await adapter.notify(
      `🎉 **Workflow Completed!**\n- **Status**: ${result.status}\n- **Document Title**: ${result.docTitle || 'N/A'}\n${
        result.createdWorkItemIds?.length ? `- **Work Items**: ${result.createdWorkItemIds.join(', ')}\n` : ''
      }${result.prUrl ? `- **Pull Request**: ${result.prUrl}` : ''}`
    );
  });

program.parse(process.argv);
