import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server, TEST_ORIGIN } from "@/test/server";
import { REVOKE_SKILL_URL_MS, SKILL_ZIP_FILE_NAME } from "./AgentSkillContainer";
import { ApiKeysContainer } from "./ApiKeysContainer";
import { mockApiKeysApi } from "./testing";

const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

async function skillCard() {
  return screen.findByRole("region", { name: "Agent skill" });
}

describe("Agent skill card", () => {
  // jsdom has no object URLs; the download test installs fakes and this puts the originals back.
  const { createObjectURL, revokeObjectURL } = URL;
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });

  it("explains the skill and shows both URLs and a ready-to-paste command", async () => {
    mockApiKeysApi([]);
    renderWithClient(<ApiKeysContainer />);

    const card = await skillCard();
    expect(
      within(card).getByText(
        "Give an AI agent this skill so it knows every endpoint, the flows and how to read results. Using the API itself needs an API key.",
      ),
    ).toBeInTheDocument();
    expect(within(card).getByRole("textbox", { name: "SKILL.md (Markdown)" })).toHaveValue(
      `${TEST_ORIGIN}/api/skill`,
    );
    expect(within(card).getByRole("textbox", { name: "Skill folder (.zip)" })).toHaveValue(
      `${TEST_ORIGIN}/api/skill.zip`,
    );
    expect(within(card).getByRole("region", { name: "Command to save the skill" })).toHaveTextContent(
      `curl ${TEST_ORIGIN}/api/skill -o SKILL.md`,
    );
  });

  it("copies each URL and the command, announcing it", async () => {
    mockApiKeysApi([]);
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();
    const card = await skillCard();
    const status = within(card).getByRole("status");

    await user.click(within(card).getByRole("button", { name: "Copy SKILL.md URL" }));
    expect(await navigator.clipboard.readText()).toBe(`${TEST_ORIGIN}/api/skill`);
    expect(status).toHaveTextContent("Copied");

    await user.click(within(card).getByRole("button", { name: "Copy zip URL" }));
    expect(await navigator.clipboard.readText()).toBe(`${TEST_ORIGIN}/api/skill.zip`);
    expect(status).toHaveTextContent("Copied");

    await user.click(within(card).getByRole("button", { name: "Copy command" }));
    expect(await navigator.clipboard.readText()).toBe(
      `curl ${TEST_ORIGIN}/api/skill -o SKILL.md`,
    );
    expect(status).toHaveTextContent("Copied");
  });

  it("downloads the skill folder with the session and saves it as a zip", async () => {
    mockApiKeysApi([]);
    server.use(
      http.get(apiUrl("/skill.zip"), () =>
        new HttpResponse(ZIP_BYTES, { headers: { "Content-Type": "application/zip" } }),
      ),
    );
    // MSW in Node does not carry `credentials` onto the request, so read it off the call.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const createObjectURL = vi.fn((blob: Blob) => (blob instanceof Blob ? "blob:skill" : ""));
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
    renderWithClient(<ApiKeysContainer />);
    const card = await skillCard();

    fireEvent.click(within(card).getByRole("button", { name: "Download skill (.zip)" }));
    await waitFor(() => expect(clicks).toHaveLength(1));

    const skillCall = fetchSpy.mock.calls.find(([input]) => String(input) === apiUrl("/skill.zip"));
    expect(skillCall?.[1]?.credentials).toBe("include");
    expect(clicks[0].download).toBe(SKILL_ZIP_FILE_NAME);
    expect(SKILL_ZIP_FILE_NAME).toBe("voice-evaluator-skill.zip");
    expect(clicks[0].href).toBe("blob:skill");
    const blob = createObjectURL.mock.calls[0][0];
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(ZIP_BYTES);
    // Revoking in the same tick as the click can abort the download, so it waits.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:skill"), {
      timeout: REVOKE_SKILL_URL_MS + 1000,
    });
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an inline error when the download fails", async () => {
    mockApiKeysApi([]);
    server.use(
      http.get(apiUrl("/skill.zip"), () => HttpResponse.json({ detail: "Skill unavailable" }, { status: 500 })),
    );
    const createObjectURL = vi.fn(() => "blob:skill");
    Object.assign(URL, { createObjectURL });
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();
    const card = await skillCard();

    await user.click(within(card).getByRole("button", { name: "Download skill (.zip)" }));

    const alert = await within(card).findByRole("alert");
    expect(alert).toHaveTextContent("Could not download the skill");
    expect(alert).toHaveTextContent("Skill unavailable");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(within(card).getByRole("button", { name: "Download skill (.zip)" })).toBeEnabled();
  });
});
