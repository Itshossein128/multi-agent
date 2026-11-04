/** @jest-environment jsdom */
import React from "react";
import { renderUi } from "./renderUi";
import RunPage from "../apps/web/src/app/(authenticated)/o/[orgSlug]/runs/[runId]/page";
jest.mock("react", () => ({ ...jest.requireActual("react"), use: () => ({ runId: "r/1" }) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../apps/web/src/components/organization/OrgProvider", () => ({ useOrgPath: () => (path: string) => `/o/pga${path}` }));
const mockState = { run: { workflowId: "w/1", status: "completed" }, events: [], approvals: [], streamStatus: "closed", load: jest.fn(async () => { }), attach: () => jest.fn() };
jest.mock("../apps/web/src/store/useRunStore", () => ({ useRunStore: (selector: any) => selector(mockState) }));
jest.mock("../apps/web/src/services/runService", () => ({ runService: { getRunDefinition: jest.fn(async () => ({ workflow: { nodes: [], edges: [] } })) } }));
jest.mock("../apps/web/src/components/runs/ExecutionTimeline", () => ({ ExecutionTimeline: () => <div>Timeline</div> }));
jest.mock("../apps/web/src/components/runs/ApprovalPanel", () => ({ ApprovalPanel: () => null }));
test("standalone run retains timeline and links to tenant canvas", async () => {
  const view = await renderUi(<RunPage params={Promise.resolve({ runId: "r/1" })}/>);
  expect(view.container.textContent).toContain("Timeline");
  const link = [...view.container.querySelectorAll("a")].find(a => a.textContent === "Open on canvas")!;
  expect(link.getAttribute("href")).toBe("/o/pga/org?workflowId=w%2F1&runId=r%2F1");
  await view.unmount();
});
