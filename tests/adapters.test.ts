import { CLIHumanAdapter, MattermostHumanAdapter } from '../src/adapters/humanAdapter';
import axios from 'axios';

describe('Human Interaction Adapters', () => {
  beforeEach(() => {
    process.env.AUTO_ANSWER = 'Automated Answer Test';
  });

  afterEach(() => {
    delete process.env.AUTO_ANSWER;
  });

  test('CLIHumanAdapter with auto answer', async () => {
    const cli = new CLIHumanAdapter();
    const ans = await cli.askHuman('What is your requirement?');
    expect(ans).toBe('Automated Answer Test');
  });



  test('MattermostHumanAdapter webhook trigger', async () => {
    const mm = new MattermostHumanAdapter();
    const ans = await mm.askHuman('Please confirm API design.');
    expect(ans).toBe('Automated Answer Test');
  });
});
