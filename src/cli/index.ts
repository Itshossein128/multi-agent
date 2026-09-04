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
  .description('Run Mattermost bot listener daemon or trigger a one-shot workflow')
  .argument('[prompt]', 'Optional requirement prompt. If omitted, runs as a continuous listener inside Mattermost.')
  .action(async (prompt?: string) => {
    const adapter = new MattermostHumanAdapter();
    const engine = new AgentGraphEngine();

    // If prompt provided on CLI, execute single workflow
    if (prompt && prompt.trim().length > 0) {
      console.log('\n💬 Starting Multi-Agent Workflow via Mattermost Adapter...\n');
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
      return;
    }

    // Otherwise, start the continuous listener loop waiting for messages in Mattermost!
    await adapter.startListenerLoop(async (userMessage, adp) => {
      const result = await engine.runWorkflow({
        inputPrompt: userMessage,
        humanAdapter: adp,
      });

      console.log('\n================ WORKFLOW SUMMARY ================');
      console.log(`Final Status: ${result.status}`);
      console.log(`Document Title: ${result.docTitle || 'N/A'}`);
      if (result.createdDocUrl) console.log(`BookStack Document URL: ${result.createdDocUrl}`);
      if (result.createdWorkItemIds?.length) console.log(`GitHub Issue IDs: ${result.createdWorkItemIds.join(', ')}`);
      if (result.prUrl) console.log(`GitHub Pull Request: ${result.prUrl}`);
      console.log('==================================================\n');

      await adp.notify(
        `🎉 **Workflow Completed!**\n- **Status**: ${result.status}\n- **Document Title**: ${result.docTitle || 'N/A'}\n${
          result.createdWorkItemIds?.length ? `- **Work Items**: ${result.createdWorkItemIds.join(', ')}\n` : ''
        }${result.prUrl ? `- **Pull Request**: ${result.prUrl}` : ''}`
      );
    });
  });

// If multi-agent is run with no arguments (e.g. `pnpm run dev`), default to `mattermost-bot`
if (process.argv.length <= 2) {
  process.argv.push('mattermost-bot');
}

program.parse(process.argv);
