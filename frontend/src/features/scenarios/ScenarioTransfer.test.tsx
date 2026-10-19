import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentFixture, mockAgentsApi } from "@/features/agents/testing";
import { connectionFixture, mockConnectionsApi } from "@/features/connections/testing";
import { mockRunsApi } from "@/features/runs/testing";
import { renderWithClient } from "@/test/render";
import { ScenarioEditorContainer } from "./ScenarioEditorContainer";
import { mockScenariosApi, scenarioFixture } from "./testing";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
}));

const hotel = agentFixture();
const support = agentFixture({ id: "a-support", name: "Support triage" });
const openai = connectionFixture();
const stored = scenarioFixture({ ttsConnectionId: "c-openai", voiceOverride: "coral" });

function setup(scenarios = [stored], connections = [openai]) {
  mockAgentsApi([hotel, support]);
  mockConnectionsApi(connections);
  mockRunsApi([]);
  return mockScenariosApi(scenarios, { agents: [hotel, support] });
}

async function renderEditor(scenarioId?: string) {
  const user = userEvent.setup({ delay: null });
  renderWithClient(<ScenarioEditorContainer scenarioId={scenarioId} />);
  await screen.findByLabelText("Name");
  return user;
}

async function importText(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole("button", { name: "Import" }));
  const panel = screen.getByRole("group", { name: "Import a scenario config" });
  await user.click(within(panel).getByLabelText("Exported config"));
  await user.paste(text);
  await user.click(within(panel).getByRole("button", { name: "Import" }));
}

beforeEach(() => nav.push.mockReset());
afterEach(() => window.history.replaceState(null, "", "/"));

describe("Scenario export and import", () => {
  it("exports a saved scenario with its agent and connections by name, without ids", async () => {
    setup();
    const user = await renderEditor("s-booking");

    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("dialog", { name: "Export Booking with date change" });
    const config = JSON.parse((within(dialog).getByLabelText("Exported config") as HTMLTextAreaElement).value);

    expect(config).toMatchObject({
      duet: "scenario",
      version: 1,
      agent: "Hotel booking assistant",
      ttsConnection: "OpenAI prod",
      evaluatorConnection: null,
      voiceOverride: "coral",
      criteria: [
        { text: "States the total price before confirming", kind: "must", source: "transcript", weight: 60 },
        { text: "Reads back the confirmation code", kind: "should", source: "transcript", weight: 40 },
      ],
    });
    expect(JSON.stringify(config)).not.toMatch(/"(id|agentId|ttsConnectionId)"|s-booking|c-openai|k-1/);
  });

  it("round-trips: an exported scenario imported into a new one creates the same scenario", async () => {
    setup();
    let user = await renderEditor("s-booking");
    await user.click(screen.getByRole("button", { name: "Export" }));
    const text = (within(await screen.findByRole("dialog")).getByLabelText("Exported config") as HTMLTextAreaElement).value;
    cleanup();

    const api = setup([]);
    user = await renderEditor();
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
    await importText(user, text);
    expect(screen.getByText(/The form was filled from the imported config/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Booking with date change");
    expect(api.requests).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Create scenario" }));
    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0].body).toMatchObject({
      agentId: "a-hotel",
      name: "Booking with date change",
      tags: ["booking", "regression"],
      persona: stored.persona,
      ttsConnectionId: "c-openai",
      voiceOverride: "coral",
      goal: stored.goal,
      facts: stored.facts,
      criteria: [
        { text: "States the total price before confirming", kind: "must", source: "transcript", weight: 60 },
        { text: "Reads back the confirmation code", kind: "should", source: "transcript", weight: 40 },
      ],
      endConditions: { maxDurationS: 360, hangUpWhen: "goal_or_goodbye" },
    });
  });

  it("notes the agent and connections this server lacks and leaves them for the user to pick", async () => {
    const api = setup([], [openai]);
    const user = await renderEditor();

    await importText(
      user,
      JSON.stringify({
        duet: "scenario",
        version: 1,
        agent: "Lola personal shopper",
        name: "Imported",
        ttsConnection: "Staging voice",
        evaluatorConnection: "openai prod",
        persona: { name: "Ana", locale: "es-CO", temperament: "calm", notes: "" },
        goal: "Find a dress.",
        criteria: [{ text: "Suggests one", kind: "must", source: "transcript", weight: 100 }],
      }),
    );

    expect(screen.getByText("No agent is named “Lola personal shopper” here: pick the agent under test.")).toBeInTheDocument();
    expect(screen.getByText("No connection is named “Staging voice” here: pick one.")).toBeInTheDocument();
    // Names match case-insensitively: "openai prod" is found.
    expect(screen.queryByText(/“openai prod”/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Evaluator voice (TTS connection)")).toHaveValue("");
    expect(screen.getByLabelText("Language")).toHaveValue("es-CO");
    // The missing agent is never replaced by another one: nothing is saved until one is picked.
    expect(screen.getByLabelText("Agent under test")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));
    expect(api.requests).toEqual([]);
    await user.selectOptions(screen.getByLabelText("Agent under test"), "Support triage");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));
    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0].body).toMatchObject({ agentId: "a-support", name: "Imported", evaluatorConnectionId: "c-openai" });
  });

  it("opens the import panel when reached from the Scenarios page's Import", async () => {
    window.history.replaceState(null, "", "/scenarios/new#import");
    setup([]);
    await renderEditor();

    expect(screen.getByRole("group", { name: "Import a scenario config" })).toBeInTheDocument();
  });

  it("refuses an agent config", async () => {
    setup([]);
    const user = await renderEditor();

    await importText(user, JSON.stringify({ duet: "agent", version: 1, name: "x" }));
    expect(screen.getByLabelText("Exported config")).toHaveAccessibleDescription(
      expect.stringContaining("This config is not a scenario."),
    );
  });
});
