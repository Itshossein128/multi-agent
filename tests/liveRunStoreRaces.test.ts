import type { ApprovalRequest, RunEvent } from "@multi-agent/types";
import { useRunStore } from "../apps/web/src/store/useRunStore";
import { runService } from "../apps/web/src/services/runService";
const mockStreams = new Map<string, { onEvent: (event: RunEvent) => void; onStatus: (status: string) => void }>();
jest.mock("../apps/web/src/services/runService", () => ({ runService: { getApprovals: jest.fn(async () => []), getRun: jest.fn(), getRunEvents: jest.fn(async () => []) } }));
jest.mock("../apps/web/src/services/runEventStream", () => ({ createRunEventStream: (runId: string, handlers: any) => { mockStreams.set(runId, handlers); return { close: jest.fn() }; } }));
const approval = (runId: string, id = "a"): ApprovalRequest => ({ id, runId, nodeId: "n", status: "requested", message: "Review", requestedAt: "2026-11-04T00:00:00Z", metadata: {} });
const event = (runId: string, sequence = 1): RunEvent => ({ id: String(sequence), runId, nodeId: "n", type: "human_approval.requested", sequence, timestamp: "2026-11-04T00:00:00Z", payload: {} });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { useRunStore.getState().clear(); jest.clearAllMocks(); mockStreams.clear(); });
test("old approval response and stale stream events cannot overwrite a new run", async () => {
 let resolveOld!: (value: ApprovalRequest[]) => void;
 (runService.getApprovals as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
 useRunStore.getState().attach("old"); const old = mockStreams.get("old")!; old.onEvent(event("old"));
 useRunStore.getState().attach("new"); useRunStore.setState({ approvals: [approval("new")] });
 resolveOld([approval("old")]); await flush(); expect(useRunStore.getState().approvals).toEqual([approval("new")]);
 old.onEvent(event("old", 2)); expect(runService.getApprovals).toHaveBeenCalledTimes(1);
 expect(useRunStore.getState().events).toEqual([]);
});
test("exit then reattach the same run does not accept an old attachment callback", async () => {
 let resolveOld!: (value: ApprovalRequest[]) => void;
 (runService.getApprovals as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
 useRunStore.getState().attach("r"); const old = mockStreams.get("r")!; old.onEvent(event("r"));
 useRunStore.getState().clear(); useRunStore.getState().attach("r"); useRunStore.setState({ approvals: [] });
 resolveOld([approval("r")]); await flush(); expect(useRunStore.getState().approvals).toEqual([]);
 old.onEvent(event("r", 2)); old.onStatus("error");
 expect(runService.getApprovals).toHaveBeenCalledTimes(1); expect(useRunStore.getState().events).toEqual([]); expect(useRunStore.getState().streamStatus).not.toBe("error");
});
test("the newest same-run approval refresh wins when responses complete out of order", async () => {
 let first!: (value: ApprovalRequest[]) => void, second!: (value: ApprovalRequest[]) => void;
 (runService.getApprovals as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
 useRunStore.getState().attach("r"); const stream = mockStreams.get("r")!; stream.onEvent(event("r", 1)); stream.onEvent(event("r", 2));
 second([]); await flush(); first([approval("r")]); await flush();
 expect(useRunStore.getState().approvals).toEqual([]);
});

test("lifecycle evidence arriving during load updates the fetched run snapshot", async () => {
 let resolveRun!: (value: any) => void;
 (runService.getRun as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveRun = resolve; }));
 (runService.getApprovals as jest.Mock).mockResolvedValue([]);
 const loading = useRunStore.getState().load("r"); useRunStore.getState().attach("r");
 mockStreams.get("r")!.onEvent(event("r"));
 resolveRun({ id: "r", workflowId: "w", status: "running", startedAt: "2026-11-04T00:00:00Z", metadata: {} }); await loading;
 expect(useRunStore.getState().run?.status).toBe("waiting_for_human"); expect(useRunStore.getState().run?.currentNodeId).toBe("n");
});
test("a terminal fetched run cannot be downgraded by old nonterminal evidence", async () => {
 (runService.getRun as jest.Mock).mockResolvedValue({ id: "r", workflowId: "w", status: "completed", startedAt: "2026-11-04T00:00:00Z", metadata: {} });
 (runService.getRunEvents as jest.Mock).mockResolvedValueOnce([{ ...event("r"), type: "run.started" }]);
 await useRunStore.getState().load("r"); expect(useRunStore.getState().run?.status).toBe("completed");
});

test("an explicit post-decision refresh supersedes an older SSE approval refresh", async () => {
 let old!: (value: ApprovalRequest[]) => void;
 (runService.getApprovals as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValueOnce([]);
 useRunStore.getState().attach("r"); mockStreams.get("r")!.onEvent(event("r"));
 await useRunStore.getState().refreshApprovals("r");
 old([approval("r")]); await flush(); expect(useRunStore.getState().approvals).toEqual([]);
});

test.each(["human_approval.needs_clarification", "human_approval.rejection_halt"] as const)("%s refreshes authoritative approval state", async type => {
 (runService.getApprovals as jest.Mock).mockResolvedValueOnce([]);
 useRunStore.getState().attach("r"); mockStreams.get("r")!.onEvent({ ...event("r"), type }); await flush();
 expect(runService.getApprovals).toHaveBeenCalledWith("r");
});
