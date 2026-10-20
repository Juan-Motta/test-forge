import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { ApiConnection } from "./ApiConnection";
import { apiFixture } from "./testing";

const api = apiFixture({
  secrets: [
    { name: "apiKey", hint: "••••7890" },
    { name: "clientSecret", hint: "••••" },
  ],
});

describe("secret reveal", () => {
  it("keeps each chip's spinner while one request is in flight, and sends no duplicate", async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(apiUrl("/apis/:id/secrets"), async () => {
        calls += 1;
        await gate;
        return HttpResponse.json({ secrets: { apiKey: "sk-live-1234567890", clientSecret: "abc" } });
      }),
    );
    const user = userEvent.setup({ delay: null });
    renderWithClient(<ApiConnection api={api} />);

    await user.click(screen.getByRole("button", { name: "Show apiKey" }));
    await user.click(screen.getByRole("button", { name: "Show clientSecret" }));
    // A second click on the first eye while it waits does nothing.
    await user.click(screen.getByRole("button", { name: "Show apiKey" }));

    expect(screen.getByRole("button", { name: "Show apiKey" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Show clientSecret" })).toHaveAttribute("aria-busy", "true");
    expect(calls).toBeLessThanOrEqual(2);

    release();
    expect(await screen.findByText("sk-live-1234567890")).toBeInTheDocument();
    expect(screen.getByText("abc")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide apiKey" })).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("button", { name: "Hide clientSecret" })).not.toHaveAttribute("aria-busy");
    await waitFor(() => expect(calls).toBe(1));
  });
});
