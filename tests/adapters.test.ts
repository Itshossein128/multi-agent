import { CLIHumanAdapter } from '../src/adapters/humanAdapter';

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
});
