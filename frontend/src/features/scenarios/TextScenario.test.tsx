import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const chat = agentFixture({
  id: "a-chat",
  name: "Chat desk",
  kind: "text",
  protocol: "auto",
  baseUrl: "https://api.example.com",
  channelId: "2a8204d3-bd82-4799-a8e8-8e669f318fec",
  userId: null,
  textMode: "stream",
  auth: "none",
});
const hotel = agentFixture();
const agents = [chat, hotel];
const connections = [connectionFixture(), connectionFixture({ id: "c-lf", name: "Traces", kind: "langfuse" })];

function setup(scenarios = [scenarioFixture({ agentId: "a-chat", agent: { id: "a-chat", name: "Chat desk" } })]) {
  mockAgentsApi(agents);
  mockConnectionsApi(connections);
  return mockScenariosApi(scenarios, { agents });
}

async function renderEditor(scenarioId?: string) {
  const user = userEvent.setup({ delay: null });
  renderWithClient(<ScenarioEditorContainer scenarioId={scenarioId} />);
  await screen.findByLabelText("Name");
  return user;
}

const field = (label: string) => screen.getByLabelText(label);

async function fillMinimum(user: UserEvent) {
  await user.type(field("Name"), "Late check-out");
  await user.type(field("Persona name"), "Marta");
  await user.type(field("Goal"), "Get a late check-out at 2 pm.");
  await user.type(field("Criterion 1 Text"), "Offers a late check-out");
}

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
});

describe("Scenario editor: text agents", () => {
  it("hides the voice-only settings and shows max turns", async () => {
    setup([]);
    await renderEditor();

    expect(field("Agent under test")).toHaveValue("a-chat");
    expect(screen.queryByLabelText("Voice override (optional)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Evaluator voice (TTS connection)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Max silence (s)")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Evaluator" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Interruptions/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /When the conversation ends/ })).toBeInTheDocument();
    expect(field("Max turns")).toHaveValue(20);
    expect(field("Evaluator model connection")).toHaveAccessibleDescription(
      expect.stringContaining("Required for text agents"),
    );
  });

  it("requires the evaluator model and sends max turns", async () => {
    const api = setup([]);
    const user = await renderEditor();

    await fillMinimum(user);
    await user.clear(field("Max turns"));
    await user.type(field("Max turns"), "8");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));
    expect(await screen.findByText("Choose the chat model that plays the user.")).toBeInTheDocument();
    expect(api.requests).toEqual([]);

    await user.selectOptions(field("Evaluator model connection"), "OpenAI prod");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0].body).toMatchObject({
      agentId: "a-chat",
      evaluatorConnectionId: "c-openai",
      endConditions: { maxDurationS: 360, maxSilenceS: 15, maxTurns: 8, hangUpWhen: "goal_or_goodbye" },
    });
  });

  it("refuses max turns out of range", async () => {
    setup([]);
    const user = await renderEditor();

    await user.clear(field("Max turns"));
    await user.type(field("Max turns"), "101");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));

    expect(await screen.findByText("Use a whole number of turns from 1 to 100.")).toBeInTheDocument();
  });

  it("shows the voice settings again for a voice agent, without max turns", async () => {
    setup([]);
    const user = await renderEditor();

    await user.selectOptions(field("Agent under test"), "Hotel booking assistant");

    expect(field("Voice override (optional)")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /When the call ends/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Max turns")).not.toBeInTheDocument();
  });

  it("launches a text scenario as conversations", async () => {
    setup([
      scenarioFixture({
        agentId: "a-chat",
        agent: { id: "a-chat", name: "Chat desk" },
        evaluatorConnectionId: "c-openai",
        endConditions: { maxDurationS: 360, maxSilenceS: 15, maxTurns: 12, hangUpWhen: "goal_or_goodbye" },
      }),
    ]);
    mockRunsApi([], { scenarioNames: { "s-booking": "Booking with date change" } });
    await renderEditor("s-booking");

    expect(field("Max turns")).toHaveValue(12);
    const rail = screen.getByRole("region", { name: "Launch a batch" });
    expect(within(rail).getByText("1 conversation")).toBeInTheDocument();
    expect(within(rail).getByRole("checkbox", { name: "Judge automatically when each conversation ends" })).toBeChecked();
  });
});
