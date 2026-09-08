import { StateGraph, START, END, Annotation } from '@langchain/langgraph';

const State = Annotation.Root({
  x: Annotation.Root({
    value: (a, b) => (b ?? a),
    default: () => 0,
  }),
});

const g = new StateGraph(State);
g.addNode('a', async (state) => ({ x: (state.x || 0) + 1 }));
g.addNode('b', async (state) => ({ x: (state.x || 0) + 2 }));
g.addEdge(START, 'a');
g.addEdge('a', 'b');
g.addEdge('b', END);

const c = g.compile({});

for await (const chunk of await c.streamEvents({ x: 1 }, { version: 'v3', streamMode: ['values', 'updates', 'messages'] })) {
  console.log(JSON.stringify(chunk));
}
