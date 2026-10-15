import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { ModelPricesContainer } from "./ModelPricesContainer";
import { mockPricingApi, SEEDED_PRICES } from "./testing";

describe("Model prices settings", () => {
  it("shows the price table with its source, as-of date and the approximate note", async () => {
    mockPricingApi();
    renderWithClient(<ModelPricesContainer />);

    const table = await screen.findByRole("table", { name: "Model prices" });
    const luna = within(table).getByRole("row", { name: /gpt-6-luna/ });
    expect(within(luna).getByRole("spinbutton", { name: "gpt-6-luna text input" })).toHaveValue(0.1);
    expect(within(luna).getByRole("spinbutton", { name: "gpt-6-luna audio output" })).toHaveValue(null);
    const source = screen.getByRole("link", { name: /OpenAI pricing/ });
    expect(source).toHaveAttribute("href", "https://developers.openai.com/api/docs/pricing");
    expect(source).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/as of 2026-10-15/)).toBeInTheDocument();
    expect(screen.getByText(/Azure OpenAI prices are not published/)).toBeInTheDocument();
  });

  it("saves edited prices, an empty field meaning no price", async () => {
    const api = mockPricingApi();
    renderWithClient(<ModelPricesContainer />);
    const user = userEvent.setup();

    const textIn = await screen.findByRole("spinbutton", { name: "gpt-6-luna text input" });
    await user.clear(textIn);
    await user.type(textIn, "0.25");
    await user.clear(screen.getByRole("spinbutton", { name: "gpt-6-luna cached text input" }));
    await user.click(screen.getByRole("button", { name: "Save prices" }));

    await waitFor(() => expect(api.saved).toHaveLength(1));
    const { items } = api.saved[0] as { items: typeof SEEDED_PRICES };
    expect(items.find((item) => item.model === "gpt-6-luna")).toEqual({
      model: "gpt-6-luna",
      textIn: 0.25,
      cachedTextIn: null,
      audioIn: null,
      cachedAudioIn: null,
      textOut: 0.5,
      audioOut: null,
    });
    expect(items).toHaveLength(SEEDED_PRICES.length);
    expect(await screen.findByRole("status")).toHaveTextContent("Prices saved.");
  });

  it("refuses a negative price without saving", async () => {
    const api = mockPricingApi();
    renderWithClient(<ModelPricesContainer />);
    const user = userEvent.setup();

    const textOut = await screen.findByRole("spinbutton", { name: "gpt-6-luna text output" });
    await user.clear(textOut);
    await user.type(textOut, "-1");
    await user.click(screen.getByRole("button", { name: "Save prices" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Prices must be zero or more.");
    expect(textOut).toHaveAttribute("aria-invalid", "true");
    expect(api.saved).toHaveLength(0);
  });

  it("shows the server's error when saving fails", async () => {
    mockPricingApi();
    server.use(http.put(apiUrl("/pricing"), () => HttpResponse.json({ detail: "Database unavailable" }, { status: 503 })));
    renderWithClient(<ModelPricesContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Save prices" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
  });
});
