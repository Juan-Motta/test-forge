import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { LoginContainer } from "./LoginContainer";
import { sessionQueryKey } from "./session";

const nav = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => nav.params,
}));

const user = { id: "u1", email: "ada@example.com", displayName: "Ada" };

function loginSucceeds() {
  const bodies: unknown[] = [];
  server.use(
    http.post(apiUrl("/auth/login"), async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ user, expiresAt: "2026-10-10T00:00:00Z" });
    }),
  );
  return bodies;
}

async function submit(email = "ada@example.com", password = "correct horse battery") {
  const actor = userEvent.setup();
  await actor.type(screen.getByLabelText("Email"), email);
  await actor.type(screen.getByLabelText("Password"), password);
  await actor.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginContainer", () => {
  beforeEach(() => {
    nav.replace.mockReset();
    nav.params = new URLSearchParams();
  });

  it("signs in, caches the user and goes to the requested page", async () => {
    nav.params = new URLSearchParams({ next: "/runs?status=failed" });
    const bodies = loginSucceeds();
    const { queryClient } = renderWithClient(<LoginContainer />);

    await submit();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/runs?status=failed"));
    expect(bodies).toEqual([{ email: "ada@example.com", password: "correct horse battery" }]);
    expect(queryClient.getQueryData(sessionQueryKey)).toEqual(user);
  });

  it.each(["//evil.com", "https://evil.com/phish", "/\\evil.com"])(
    "ignores an unsafe next (%s) and goes home",
    async (next) => {
      nav.params = new URLSearchParams({ next });
      loginSucceeds();
      renderWithClient(<LoginContainer />);

      await submit();

      await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/"));
    },
  );

  it("shows one generic message for invalid credentials", async () => {
    server.use(
      http.post(apiUrl("/auth/login"), () =>
        HttpResponse.json({ detail: "Invalid email or password" }, { status: 401 }),
      ),
    );
    renderWithClient(<LoginContainer />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("tells the user how long to wait when throttled", async () => {
    server.use(
      http.post(apiUrl("/auth/login"), () =>
        HttpResponse.json(
          { detail: "Too many login attempts, try again later" },
          { status: 429, headers: { "Retry-After": "130" } },
        ),
      ),
    );
    renderWithClient(<LoginContainer />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts, try again in 3 minutes.");
  });

  it("disables the submit button while the request is pending", async () => {
    let release: () => void = () => {};
    server.use(
      http.post(apiUrl("/auth/login"), async () => {
        await new Promise<void>((resolve) => (release = resolve));
        return HttpResponse.json({ user, expiresAt: "2026-10-10T00:00:00Z" });
      }),
    );
    renderWithClient(<LoginContainer />);

    await submit();

    const button = await screen.findByRole("button", { name: "Signing in…" });
    expect(button).toBeDisabled();
    release();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/"));
  });

  it("validates the form before calling the backend", async () => {
    const bodies = loginSucceeds();
    renderWithClient(<LoginContainer />);
    const actor = userEvent.setup();

    await actor.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByLabelText("Email")).toHaveAccessibleDescription("Enter your email address.");
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Enter your password.");
    expect(bodies).toEqual([]);
  });
});
