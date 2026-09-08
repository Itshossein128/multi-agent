const { StateGraph, START, END, Annotation } = require('@langchain/langgraph');
const g = new StateGraph(Annotation.Root({x: Annotation.Root({value:(a,b)=>b??a, default:()=>0})}));
g.addNode('a', async (state) => ({x: (state.x || 0)+1}));
g.addEdge(START,'a'); g.addEdge('a',END); const c=g.compile({});
(async () => {
  const stream = await c.streamEvents({x:0},{ version: 'v3', streamMode:['values']});
  console.log('hasAbort', typeof stream.abort, 'hasController', stream.signal?.constructor?.name);
  console.log('iterable', typeof stream[Symbol.asyncIterator]);
})();
