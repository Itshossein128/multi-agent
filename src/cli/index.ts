#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { CLIHumanAdapter } from '../adapters/humanAdapter';
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
  .command('onboard')
  .description('Guided local first-run onboarding: check prerequisites, migrations, and run an offline self-test')
  .option('--database-url <url>', 'PostgreSQL database connection URL')
  .option('--migrate', 'Automatically apply pending database migrations')
  .option('--no-self-test', 'Skip offline self-test agent run')
  .option('--json', 'Output report as JSON')
  .action(async (opts: { databaseUrl?: string; migrate?: boolean; selfTest?: boolean; json?: boolean }) => {
    const { runOnboarding, printOnboardingReport } = await import('./onboard');
    const report = await runOnboarding({
      databaseUrl: opts.databaseUrl,
      applyMigrations: opts.migrate,
      runSelfTest: opts.selfTest,
      json: opts.json,
    });
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printOnboardingReport(report);
    }
  });

program.parse(process.argv);
