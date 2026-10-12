import { QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { use } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { AppShell } from "./AppShell";

const nav = vi.hoisted(() => ({
  replaceLocation: vi.fn(),
  redirectToLogin: vi.fn(),
  pathname: "/",
  /** While set, `usePathname` suspends, as it does for a route with an unknown dynamic param. */
  pending: null as Promise<void> | null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => {
    if (nav.pending) use(nav.pending);
    return nav.pathname;
  },
}));

/** Makes `usePathname` suspend until the returned function resolves it. */
function suspendPathname(): () => void {
  let resolve = () => {};
  nav.pending = new Promise<void>((done) => (resolve = done));
  return () => {
    nav.pending = null;
    resolve();
  };
}
vi.mock("@/lib/navigation/redirect", () => ({
  replaceLocation: nav.replaceLocation,
  redirectToLogin: nav.redirectToLogin,
}));

/** Active-run counts (list totals) per status for the Live sessions badge. */
function activeRuns(totals: Partial<Record<"queued" | "connecting" | "running", number>> = {}) {
  server.use(
    http.get(apiUrl("/runs"), ({ request }) => {
      const status = new URL(request.url).searchParams.get("status") as keyof typeof totals;
      return HttpResponse.json({ items: [], total: totals[status] ?? 0 });
    }),
  );
}

function signedIn() {
  const calls = { me: 0 };
  activeRuns();
  server.use(
    http.get(apiUrl("/auth/me"), () => {
      calls.me += 1;
      return HttpResponse.json({ id: "u1", email: "ada@example.com", displayName: "Ada Lovelace" });
    }),
  );
  return calls;
}

describe("AppShell", () => {
  beforeEach(() => {
    nav.replaceLocation.mockReset();
    nav.redirectToLogin.mockReset();
    nav.pathname = "/";
    nav.pending = null;
  });

  it("loads the account once while the navigation waits for the pathname", async () => {
    const calls = signedIn();
    let releaseMe = () => {};
    const meGate = new Promise<void>((done) => (releaseMe = done));
    server.use(
      http.get(apiUrl("/auth/me"), async () => {
        calls.me += 1;
        await meGate;
        return HttpResponse.json({ id: "u1", email: "ada@example.com", displayName: "Ada Lovelace" });
      }),
    );
    const resolvePathname = suspendPathname();
    await act(async () => {
      renderWithClient(
        <AppShell>
          <p>content</p>
        </AppShell>,
      );
    });
    await waitFor(() => expect(calls.me).toBe(1));
    expect(screen.getByText("Loading account")).toBeInTheDocument();

    await act(async () => resolvePathname());
    act(() => releaseMe());

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(calls.me).toBe(1);
  });

  it("keeps the cached account on screen when a navigation suspends the sidebar", async () => {
    const calls = signedIn();
    const shell = (page: string) => (
      <AppShell>
        <p>{page}</p>
      </AppShell>
    );
    const { rerender, queryClient } = renderWithClient(shell("overview"));
    await screen.findByText("Ada Lovelace");

    nav.pathname = "/scenarios/s-1";
    suspendPathname(); // the sidebar falls back while the new route's pathname is unknown
    await act(async () => {
      rerender(<QueryClientProvider client={queryClient}>{shell("editor")}</QueryClientProvider>);
    });

    expect(screen.getByText("editor")).toBeInTheDocument();
    expect(screen.queryByText("Loading account")).not.toBeInTheDocument();
    // The cached account is reused, not refetched because the sidebar remounted.
    await new Promise((done) => setTimeout(done, 50));
    expect(calls.me).toBe(1);
  });

  it("renders the page inside the shell with the current user", async () => {
    signedIn();
    renderWithClient(
      <AppShell>
        <h1>Overview</h1>
      </AppShell>,
    );

    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("signs out through the backend and reloads into the login page", async () => {
    const calls = signedIn();
    let logoutCalls = 0;
    server.use(
      http.post(apiUrl("/auth/logout"), () => {
        logoutCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithClient(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    await screen.findByText("Ada Lovelace");

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(nav.replaceLocation).toHaveBeenCalledWith("/login"));
    expect(logoutCalls).toBe(1);
    // The revoked session is not asked for again (that would bounce through a 401).
    expect(calls.me).toBe(1);
    expect(nav.redirectToLogin).not.toHaveBeenCalled();
  });

  it("keeps the user on the page and says so when sign-out fails", async () => {
    signedIn();
    server.use(http.post(apiUrl("/auth/logout"), () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
    renderWithClient(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    await screen.findByText("Ada Lovelace");

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign out. Try again.");
    expect(nav.replaceLocation).not.toHaveBeenCalled();
  });

  it("toggles the navigation from the mobile menu button", async () => {
    signedIn();
    renderWithClient(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    const toggle = screen.getByRole("button", { name: "Open navigation" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the mobile navigation when the route changes, however the navigation happened", async () => {
    signedIn();
    const shell = () => (
      <AppShell>
        <p>content</p>
      </AppShell>
    );
    const { rerender, queryClient } = renderWithClient(shell());
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveAttribute("aria-expanded", "true");

    nav.pathname = "/runs"; // e.g. browser back, or a link outside the drawer
    rerender(<QueryClientProvider client={queryClient}>{shell()}</QueryClientProvider>);

    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
  });

  it("badges Live sessions with the number of queued, connecting and running runs", async () => {
    signedIn();
    activeRuns({ queued: 1, connecting: 1, running: 2 });
    renderWithClient(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    expect(await screen.findByRole("link", { name: "Live sessions (4 active)" })).toBeInTheDocument();
  });
});
