import { CLIHumanAdapter, WebHumanAdapter, MattermostHumanAdapter } from '../src/adapters/humanAdapter';
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

  test('WebHumanAdapter HTTP endpoint interaction', async () => {
    const web = new WebHumanAdapter(8089);
    await web.startServer();

    // Test askHuman without AUTO_ANSWER first
    delete process.env.AUTO_ANSWER;
    const askPromise = web.askHuman('What database do you prefer?');

    // Fetch pending questions via HTTP
    const resGet = await axios.get('http://localhost:8089/api/questions');
    expect(resGet.data.questions.length).toBe(1);
    const qId = resGet.data.questions[0].id;

    // Answer pending question via HTTP
    await axios.post(`http://localhost:8089/api/questions/${qId}/answer`, { answer: 'PostgreSQL' });

    const answer = await askPromise;
    expect(answer).toBe('PostgreSQL');

    await web.stopServer();
  });

  test('MattermostHumanAdapter webhook trigger', async () => {
    const mm = new MattermostHumanAdapter();
    const ans = await mm.askHuman('Please confirm API design.');
    expect(ans).toBe('Automated Answer Test');
  });
});
