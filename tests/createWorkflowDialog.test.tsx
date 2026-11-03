/**
 * @jest-environment jsdom
 */
import { CreateWorkflowDialog } from "../apps/web/src/components/workflow/CreateWorkflowDialog";
import { ARCHETYPE_DESCRIPTORS } from "@multi-agent/types";
import { renderUi, setInputValue } from "./renderUi";

describe("CreateWorkflowDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("defaults to Linear Pipeline and shows both behavioral descriptions", async () => {
    const view = await renderUi(
      <CreateWorkflowDialog isOpen onClose={() => undefined} onSubmit={async () => undefined} />,
    );
    const linear = view.container.querySelector<HTMLInputElement>('input[value="linear-pipeline"]');
    const supervisor = view.container.querySelector<HTMLInputElement>('input[value="hierarchical-supervisor"]');
    expect(linear?.checked).toBe(true);
    expect(supervisor?.checked).toBe(false);
    expect(view.container.textContent).toContain(ARCHETYPE_DESCRIPTORS["linear-pipeline"].description);
    expect(view.container.textContent).toContain(ARCHETYPE_DESCRIPTORS["hierarchical-supervisor"].description);
    expect(view.container.textContent).toContain("Sequential, deterministic multi-agent pipeline executing an acyclic directed graph");
    expect(view.container.textContent).toContain("Hub-and-spoke multi-agent coordination architecture with dynamic condition routing");
    await view.unmount();
  });

  test("rejects a blank name and submits the trimmed name with the selected archetype", async () => {
    const submitted: Array<{ name: string; archetype: string }> = [];
    const view = await renderUi(
      <CreateWorkflowDialog
        isOpen
        onClose={() => undefined}
        onSubmit={async (payload) => { submitted.push(payload); }}
      />,
    );
    const name = view.container.querySelector<HTMLInputElement>('input[aria-label="Workflow name"]')!;
    await setInputValue(name, "   ");
    view.container.querySelector("form")?.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.container.textContent).toContain("Workflow name must be 1–200 characters.");
    expect(submitted).toEqual([]);

    await setInputValue(name, "  Test Supervisor  ");
    const supervisor = view.container.querySelector<HTMLInputElement>('input[value="hierarchical-supervisor"]')!;
    supervisor.click();
    view.container.querySelector("form")?.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submitted).toEqual([{ name: "Test Supervisor", archetype: "hierarchical-supervisor" }]);
    await view.unmount();
  });

  test("Escape closes the dialog and Enter submits", async () => {
    const closed = jest.fn();
    const submitted = jest.fn(async () => undefined);
    const view = await renderUi(
      <CreateWorkflowDialog isOpen onClose={closed} onSubmit={submitted} />,
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(closed).toHaveBeenCalled();

    const name = view.container.querySelector<HTMLInputElement>('input[aria-label="Workflow name"]')!;
    await setInputValue(name, "Intake");
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    view.container.querySelector("form")?.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submitted).toHaveBeenCalledWith({ name: "Intake", archetype: "linear-pipeline" });
    await view.unmount();
  });
});
