import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentFixture, mockAgentsApi } from "@/features/agents/testing";
import { connectionFixture, mockConnectionsApi } from "@/features/connections/testing";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { ScenarioEditorContainer } from "./ScenarioEditorContainer";
import { mockScenariosApi, scenarioFixture } from "./testing";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
}));

const hotel = agentFixture();
const support = agentFixture({ id: "a-support", name: "Support triage", context: "Triage desk for support calls." });
const agents = [hotel, support];
const connections = [
  connectionFixture(),
  connectionFixture({ id: "c-azure", name: "Azure TTS", kind: "azure_openai" }),
  connectionFixture({
    id: "c-azure-chat",
    name: "Azure chat",
    kind: "azure_openai",
    config: { endpoint: "https://res.openai.azure.com", ttsDeployment: "tts", chatDeployment: "chat" },
  }),
  connectionFixture({ id: "c-speech", name: "Speech", kind: "azure_speech" }),
  connectionFixture({ id: "c-lf", name: "Traces", kind: "langfuse" }),
];

function setup(scenarios = [scenarioFixture()]) {
  mockAgentsApi(agents);
  mockConnectionsApi(connections);
  return mockScenariosApi(scenarios, { agents });
}

async function renderEditor(scenarioId?: string) {
  // No pause between keystrokes: these forms type a lot and must stay well within the timeout.
  const user = userEvent.setup({ delay: null });
  renderWithClient(<ScenarioEditorContainer scenarioId={scenarioId} />);
  await screen.findByLabelText("Name");
  return user;
}

const field = (label: string) => screen.getByLabelText(label);

async function retype(user: UserEvent, label: string, text: string) {
  await user.clear(field(label));
  await user.type(field(label), text);
}

/** The required fields of a new scenario, with a single criterion weighing 100. */
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

describe("Scenario editor: create", () => {
  it("posts the camelCase payload with facts, weighted criteria and end conditions, then opens it", async () => {
    const api = setup([]);
    const user = await renderEditor();

    await fillMinimum(user);
    await user.type(field("Tags"), "checkout, vip, checkout");
    await user.type(field("Scenario-specific context"), "The guest is a loyalty member.");
    await retype(user, "Locale", "es-ES");
    await user.click(screen.getByRole("radio", { name: "Friendly" }));
    await user.type(field("Persona notes"), "Polite but firm.");
    await user.selectOptions(field("Evaluator voice (TTS connection)"), "OpenAI prod");
    await user.type(field("Voice override (optional)"), "coral");
    await user.selectOptions(field("Evaluator model connection"), "Azure chat");
    await user.type(field("How to behave"), "Ask about the fee.");
    await user.click(screen.getByRole("button", { name: "Add fact" }));
    await user.type(field("Fact 1 Key"), "Room");
    await user.type(field("Fact 1 Value"), "412");
    await retype(user, "Criterion 1 Weight", "70");
    await user.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(field("Criterion 2 Weight")).toHaveValue(30);
    await user.type(field("Criterion 2 Text"), "Mentions the fee");
    await user.selectOptions(field("Criterion 2 Kind"), "Should");
    await user.selectOptions(field("Criterion 2 Evidence"), "Trace");
    await retype(user, "Max duration (s)", "300");
    await user.selectOptions(field("Hang up when"), "Goodbye said");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/scenarios/s-new-1"));
    expect(api.requests).toEqual([
      {
        method: "POST",
        path: "/scenarios",
        body: {
          agentId: "a-hotel",
          name: "Late check-out",
          tags: ["checkout", "vip"],
          context: "The guest is a loyalty member.",
          persona: { name: "Marta", locale: "es-ES", temperament: "friendly", notes: "Polite but firm." },
          ttsConnectionId: "c-openai",
          evaluatorConnectionId: "c-azure-chat",
          voiceOverride: "coral",
          goal: "Get a late check-out at 2 pm.",
          instructions: "Ask about the fee.",
          facts: [{ key: "Room", value: "412" }],
          criteria: [
            { text: "Offers a late check-out", kind: "must", source: "transcript", weight: 70 },
            { text: "Mentions the fee", kind: "should", source: "trace", weight: 30 },
          ],
          endConditions: { maxDurationS: 300, maxSilenceS: 15, hangUpWhen: "goodbye" },
        },
      },
    ]);
  });

  it("shows the live weight total and blocks saving until it is exactly 100", async () => {
    const api = setup([]);
    const user = await renderEditor();
    await fillMinimum(user);

    await retype(user, "Criterion 1 Weight", "60");
    await user.click(screen.getByRole("button", { name: "Add criterion" }));
    await user.type(field("Criterion 2 Text"), "Mentions the fee");
    await retype(user, "Criterion 2 Weight", "30");
    expect(screen.getByText("Weights total 90 of 100")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create scenario" }));

    const message = await screen.findByText("Weights must total exactly 100; they total 90.");
    expect(message).toHaveFocus();
    expect(api.requests).toEqual([]);

    await retype(user, "Criterion 2 Weight", "40");
    expect(screen.getByText("Weights total 100 of 100")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create scenario" }));
    await waitFor(() => expect(api.requests).toHaveLength(1));
  });

  it("refuses two facts with the same key, whatever the case", async () => {
    const api = setup([]);
    const user = await renderEditor();
    await fillMinimum(user);

    await user.click(screen.getByRole("button", { name: "Add fact" }));
    await user.type(field("Fact 1 Key"), "Room");
    await user.type(field("Fact 1 Value"), "412");
    await user.click(screen.getByRole("button", { name: "Add fact" }));
    await user.type(field("Fact 2 Key"), "room ");
    await user.type(field("Fact 2 Value"), "413");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));

    await waitFor(() => expect(field("Fact 2 Key")).toHaveFocus());
    expect(field("Fact 2 Key")).toHaveAccessibleDescription("Each fact needs a different key.");
    expect(api.requests).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Remove fact 2" }));
    await user.click(screen.getByRole("button", { name: "Create scenario" }));
    await waitFor(() => expect(api.requests).toHaveLength(1));
  });

  it("describes required fields and focuses the first error after a failed save", async () => {
    setup([]);
    const user = await renderEditor();

    await user.click(screen.getByRole("button", { name: "Create scenario" }));

    await waitFor(() => expect(field("Name")).toHaveFocus());
    expect(field("Name")).toHaveAccessibleDescription("Enter a name.");
    expect(field("Name")).toHaveAttribute("aria-invalid", "true");
    expect(field("Persona name")).toHaveAccessibleDescription("Enter the persona's name.");
    expect(field("Goal")).toHaveAccessibleDescription(expect.stringContaining("Describe what the caller wants."));
    expect(field("Criterion 1 Text")).toHaveAccessibleDescription("Describe the criterion.");
  });

  it("puts a name taken under the same agent on the name field", async () => {
    setup([scenarioFixture()]);
    const user = await renderEditor();
    await fillMinimum(user);
    await retype(user, "Name", "Booking with date change");

    await user.click(screen.getByRole("button", { name: "Create scenario" }));

    await waitFor(() =>
      expect(field("Name")).toHaveAccessibleDescription("A scenario with this name already exists for this agent."),
    );
    expect(field("Name")).toHaveFocus();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("shows the selected agent's shared context and follows the agent select", async () => {
    setup([]);
    const user = await renderEditor();

    const panel = screen.getByRole("region", { name: "Agent context" });
    expect(panel).toHaveTextContent("Voice receptionist of Hotel Mirador.");

    await user.selectOptions(field("Agent under test"), "Support triage");
    expect(panel).toHaveTextContent("Triage desk for support calls.");
    expect(panel).not.toHaveTextContent("Hotel Mirador");
  });

  it("offers only OpenAI and Azure OpenAI connections as the evaluator voice", async () => {
    setup([]);
    await renderEditor();

    const options = within(field("Evaluator voice (TTS connection)"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["None", "OpenAI prod", "Azure TTS", "Azure chat"]);
  });

  it("offers only connections with a chat model as the evaluator model, defaulting to the voice connection", async () => {
    setup([]);
    await renderEditor();

    const select = field("Evaluator model connection");
    expect(select).toHaveValue("");
    expect(select).toHaveAccessibleDescription(expect.stringContaining("chat deployment"));
    const options = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["Same as voice connection", "OpenAI prod", "Azure chat"]);
  });

  it("warns before the page unloads only while there are unsaved changes", async () => {
    setup([]);
    const user = await renderEditor();
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(unload()).toBe(false);
    await user.type(field("Name"), "Draft");
    await waitFor(() => expect(unload()).toBe(true));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("asks before Cancel discards unsaved changes", async () => {
    setup([]);
    const user = await renderEditor();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    await user.type(field("Name"), "Draft");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(nav.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(nav.push).toHaveBeenCalledWith("/scenarios");
  });
});

describe("Scenario editor: edit", () => {
  it("prefills the stored scenario and sends only the changed top-level fields", async () => {
    const api = setup();
    const user = await renderEditor("s-booking");

    expect(field("Name")).toHaveValue("Booking with date change");
    expect(field("Tags")).toHaveValue("booking, regression");
    expect(screen.getByRole("radio", { name: "Hurried" })).toBeChecked();
    expect(field("Fact 2 Value")).toHaveValue("2 adults");
    await retype(user, "Goal", "Book a double room for 2 nights.");
    await retype(user, "Criterion 1 Weight", "50");
    await retype(user, "Criterion 2 Weight", "50");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0]).toEqual({
      method: "PATCH",
      path: "/scenarios/s-booking",
      body: {
        goal: "Book a double room for 2 nights.",
        criteria: [
          { id: "k-1", text: "States the total price before confirming", kind: "must", source: "transcript", weight: 50 },
          { id: "k-2", text: "Reads back the confirmation code", kind: "should", source: "transcript", weight: 50 },
        ],
      },
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("clears the evaluator voice with null", async () => {
    const api = setup([scenarioFixture({ ttsConnectionId: "c-openai", voiceOverride: "coral" })]);
    const user = await renderEditor("s-booking");

    await user.selectOptions(field("Evaluator voice (TTS connection)"), "None");
    await user.clear(field("Voice override (optional)"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0].body).toEqual({ ttsConnectionId: null, voiceOverride: null });
  });

  it("switches the evaluator model back to the voice connection with null", async () => {
    const api = setup([scenarioFixture({ evaluatorConnectionId: "c-azure-chat" })]);
    const user = await renderEditor("s-booking");

    expect(field("Evaluator model connection")).toHaveValue("c-azure-chat");
    await user.selectOptions(field("Evaluator model connection"), "Same as voice connection");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0].body).toEqual({ evaluatorConnectionId: null });
  });

  it("maps server 422 locations onto the fact and criterion rows and the criteria section", async () => {
    setup();
    server.use(
      http.patch(apiUrl("/scenarios/:id"), () =>
        HttpResponse.json(
          {
            detail: [
              { type: "string_too_long", loc: ["body", "criteria", 1, "text"], msg: "Criterion text is too long" },
              { type: "value_error", loc: ["body", "facts", 1, "key"], msg: "Fact key is not allowed" },
              { type: "value_error", loc: ["body", "criteria"], msg: "Value error, criteria weights must total 100" },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    const user = await renderEditor("s-booking");

    await retype(user, "Goal", "Something else.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(field("Fact 2 Key")).toHaveAccessibleDescription("Fact key is not allowed"));
    expect(field("Criterion 2 Text")).toHaveAccessibleDescription("Criterion text is too long");
    expect(screen.getByText("Value error, criteria weights must total 100")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Check the highlighted fields.");
    expect(field("Fact 2 Key")).toHaveFocus();
  });

  it("shows a not-found state for an unknown scenario", async () => {
    setup([]);
    renderWithClient(<ScenarioEditorContainer scenarioId="missing" />);

    expect(await screen.findByRole("heading", { name: "Scenario not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to scenarios" })).toHaveAttribute("href", "/scenarios");
  });
});
