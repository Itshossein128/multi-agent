jest.mock("../apps/web/src/lib/executionBff", () => ({ proxyExecution: jest.fn() }));

import { proxyExecution } from "../apps/web/src/lib/executionBff";
import { GET, POST, PUT, DELETE } from "../apps/web/src/app/api/execution/[...path]/route";

const mockedProxy = jest.mocked(proxyExecution);

beforeEach(() => mockedProxy.mockReset().mockResolvedValue(new Response("proxied")));

describe("execution BFF route handler", () => {
  test("catch-all route reconstructs nested paths and preserves the original request", async () => {
    const request = new Request("http://web/api/execution/runs/run-1/events?sequence=9", { method: "GET" });
    await GET(request, { params: Promise.resolve({ path: ["runs", "run-1", "events"] }) });
    expect(mockedProxy).toHaveBeenCalledWith(request, "/runs/run-1/events");
  });

  test("catch-all route dispatches mutating methods without rewriting their body or query", async () => {
    const request = new Request("http://web/api/execution/studio/workflows/a?draft=true", { method: "POST", body: '{"name":"A"}' });
    await POST(request, { params: Promise.resolve({ path: ["studio", "workflows", "a"] }) });
    const [forwarded] = mockedProxy.mock.calls[0]!;
    expect(forwarded).toBe(request);
    expect(forwarded.method).toBe("POST");
    expect(new URL(forwarded.url).search).toBe("?draft=true");
    expect(await forwarded.text()).toBe('{"name":"A"}');
  });

  describe("feature-005 studio client endpoints proxying", () => {
    test("proxies routines endpoints (list, create, preview, pause, delete, history)", async () => {
      // List routines
      const getListReq = new Request("http://web/api/execution/studio/routines", { method: "GET" });
      await GET(getListReq, { params: Promise.resolve({ path: ["studio", "routines"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(getListReq, "/studio/routines");

      // Create routine
      const postCreateReq = new Request("http://web/api/execution/studio/routines", {
        method: "POST",
        body: JSON.stringify({ name: "Daily", scheduleExpr: "0 0 * * *" }),
      });
      await POST(postCreateReq, { params: Promise.resolve({ path: ["studio", "routines"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(postCreateReq, "/studio/routines");

      // Preview routine schedule
      const postPreviewReq = new Request("http://web/api/execution/studio/routines/preview", {
        method: "POST",
        body: JSON.stringify({ scheduleExpr: "0 0 * * *", timezone: "UTC" }),
      });
      await POST(postPreviewReq, { params: Promise.resolve({ path: ["studio", "routines", "preview"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(postPreviewReq, "/studio/routines/preview");

      // Pause routine action
      const postPauseReq = new Request("http://web/api/execution/studio/routines/rtn-1/pause", { method: "POST" });
      await POST(postPauseReq, { params: Promise.resolve({ path: ["studio", "routines", "rtn-1", "pause"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(postPauseReq, "/studio/routines/rtn-1/pause");

      // Delete routine
      const deleteReq = new Request("http://web/api/execution/studio/routines/rtn-1", { method: "DELETE" });
      await DELETE(deleteReq, { params: Promise.resolve({ path: ["studio", "routines", "rtn-1"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(deleteReq, "/studio/routines/rtn-1");

      // Routine history
      const historyReq = new Request("http://web/api/execution/studio/routines/rtn-1/history", { method: "GET" });
      await GET(historyReq, { params: Promise.resolve({ path: ["studio", "routines", "rtn-1", "history"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(historyReq, "/studio/routines/rtn-1/history");
    });

    test("proxies webhook trigger endpoints (list, create, rotate-secret, delete, deliveries)", async () => {
      // List triggers
      const getListReq = new Request("http://web/api/execution/studio/webhooks/triggers", { method: "GET" });
      await GET(getListReq, { params: Promise.resolve({ path: ["studio", "webhooks", "triggers"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(getListReq, "/studio/webhooks/triggers");

      // Create trigger
      const postCreateReq = new Request("http://web/api/execution/studio/webhooks/triggers", {
        method: "POST",
        body: JSON.stringify({ name: "GH PR", targetType: "workflow", targetId: "wf-1" }),
      });
      await POST(postCreateReq, { params: Promise.resolve({ path: ["studio", "webhooks", "triggers"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(postCreateReq, "/studio/webhooks/triggers");

      // Rotate secret
      const rotateReq = new Request("http://web/api/execution/studio/webhooks/triggers/trg-1/rotate-secret", {
        method: "POST",
      });
      await POST(rotateReq, {
        params: Promise.resolve({ path: ["studio", "webhooks", "triggers", "trg-1", "rotate-secret"] }),
      });
      expect(mockedProxy).toHaveBeenLastCalledWith(rotateReq, "/studio/webhooks/triggers/trg-1/rotate-secret");

      // Delete trigger
      const deleteReq = new Request("http://web/api/execution/studio/webhooks/triggers/trg-1", { method: "DELETE" });
      await DELETE(deleteReq, { params: Promise.resolve({ path: ["studio", "webhooks", "triggers", "trg-1"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(deleteReq, "/studio/webhooks/triggers/trg-1");

      // Deliveries
      const deliveriesReq = new Request("http://web/api/execution/studio/webhooks/triggers/trg-1/deliveries", {
        method: "GET",
      });
      await GET(deliveriesReq, {
        params: Promise.resolve({ path: ["studio", "webhooks", "triggers", "trg-1", "deliveries"] }),
      });
      expect(mockedProxy).toHaveBeenLastCalledWith(deliveriesReq, "/studio/webhooks/triggers/trg-1/deliveries");
    });

    test("proxies task comments endpoints (list, create, delete)", async () => {
      // List comments
      const getCommentsReq = new Request("http://web/api/execution/studio/tasks/task-1/comments", { method: "GET" });
      await GET(getCommentsReq, { params: Promise.resolve({ path: ["studio", "tasks", "task-1", "comments"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(getCommentsReq, "/studio/tasks/task-1/comments");

      // Create comment
      const postCommentReq = new Request("http://web/api/execution/studio/tasks/task-1/comments", {
        method: "POST",
        body: JSON.stringify({ content: "Hello @coder" }),
      });
      await POST(postCommentReq, { params: Promise.resolve({ path: ["studio", "tasks", "task-1", "comments"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(postCommentReq, "/studio/tasks/task-1/comments");

      // Delete comment
      const deleteCommentReq = new Request("http://web/api/execution/studio/tasks/task-1/comments/cmt-1", {
        method: "DELETE",
      });
      await DELETE(deleteCommentReq, {
        params: Promise.resolve({ path: ["studio", "tasks", "task-1", "comments", "cmt-1"] }),
      });
      expect(mockedProxy).toHaveBeenLastCalledWith(deleteCommentReq, "/studio/tasks/task-1/comments/cmt-1");
    });

    test("proxies agent heartbeat endpoints (get, update PUT)", async () => {
      // Get heartbeat
      const getHeartbeatReq = new Request("http://web/api/execution/studio/agents/ag-1/heartbeat", { method: "GET" });
      await GET(getHeartbeatReq, { params: Promise.resolve({ path: ["studio", "agents", "ag-1", "heartbeat"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(getHeartbeatReq, "/studio/agents/ag-1/heartbeat");

      // Put heartbeat
      const putHeartbeatReq = new Request("http://web/api/execution/studio/agents/ag-1/heartbeat", {
        method: "PUT",
        body: JSON.stringify({ enabled: true, intervalSeconds: 60 }),
      });
      await PUT(putHeartbeatReq, { params: Promise.resolve({ path: ["studio", "agents", "ag-1", "heartbeat"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(putHeartbeatReq, "/studio/agents/ag-1/heartbeat");
    });

    test("preserves encoded URI components in path params", async () => {
      const encodedId = encodeURIComponent("agent/special:id");
      const req = new Request(`http://web/api/execution/studio/agents/${encodedId}/heartbeat`, { method: "GET" });
      await GET(req, { params: Promise.resolve({ path: ["studio", "agents", encodedId, "heartbeat"] }) });
      expect(mockedProxy).toHaveBeenLastCalledWith(req, `/studio/agents/${encodedId}/heartbeat`);
    });

    test("returns 500 when proxyExecution throws", async () => {
      mockedProxy.mockRejectedValueOnce(new Error("Connection refused"));
      const req = new Request("http://web/api/execution/studio/routines", { method: "GET" });
      const res = await GET(req, { params: Promise.resolve({ path: ["studio", "routines"] }) });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Connection refused");
    });
  });
});
