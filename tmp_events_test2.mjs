import { StateGraph, START, END, Annotation } from '@langchain/langgraph';

const State = Annotation.Root({
  x: Annotation.Root({ value: (a, b) => (b ?? a), default: () => 0 }),
});
const g = new StateGraph(State);
g.addNode('a', async (state) => ({ x: (state.x || 0) + 1 }));
g.addNode('b', async (state) => ({ x: (state.x || 0) + 2 }));
g.addEdge(START, 'a');
g.addEdge('a', 'b');
g.addEdge('b', END);
const c = g.compile({});
const controller = new AbortController();
setTimeout(() => controller.abort(), 2000);
(async () => {
  try {
    const stream = await c.streamEvents({ x: 1 }, { version: 'v3', streamMode: ['tasks', 'updates', 'values', 'lifecycle'], signal: controller.signal });
    let i = 0;
    for await (const chunk of stream) {
      i++;
      console.log(i, JSON.stringify(chunk));
      if (i > 80) break;
    }
  } catch (err) {
    console.error('stream threw', err?.name, err?.message);
  }
})();
