import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ReplyFormatControl } from "@/features/shell/ReplyFormatControl";
import { AgentText } from "./AgentText";

const REPLY = "¡Claro! Necesito tu **talla de brasier** primero.\n\n- Opción *uno*\n- Opción `dos`\n\n<script>alert(1)</script>";

afterEach(() => window.localStorage.clear());

describe("AgentText", () => {
  it("formats an agent's reply as Markdown by default, never running raw HTML", () => {
    const { container } = render(<AgentText text={REPLY} />);

    expect(screen.getByText("talla de brasier").tagName).toBe("STRONG");
    expect(screen.getByText("uno").tagName).toBe("EM");
    expect(screen.getByText("dos").tagName).toBe("CODE");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("**");
  });

  it("opens links in a new tab", () => {
    render(<AgentText text="See [the catalog](https://shop.example.com/catalog)." />);

    const link = screen.getByRole("link", { name: "the catalog" });
    expect(link).toHaveAttribute("href", "https://shop.example.com/catalog");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows the reply raw, as sent, once Raw is chosen in the preference", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ReplyFormatControl />
        <AgentText text={REPLY} />
      </>,
    );
    expect(screen.getByRole("radio", { name: "Formatted" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Raw" }));
    expect(screen.getByText(/Necesito tu \*\*talla de brasier\*\* primero\./)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("voice-eval:reply-format")).toBe("raw");
  });

  it("remembers Raw in this browser", () => {
    window.localStorage.setItem("voice-eval:reply-format", "raw");
    act(() => {
      render(<AgentText text="**kept as typed**" />);
    });
    expect(screen.getByText("**kept as typed**")).toBeInTheDocument();
  });
});
