import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders the eyebrow above the title, the description and the actions", () => {
    render(
      <PageHeader
        eyebrow="Runs & reports / R-2291"
        title="Booking with date change"
        description="Hotel booking"
        actions={<button type="button">Re-run</button>}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Booking with date change" });
    const eyebrow = screen.getByText("Runs & reports / R-2291");
    expect(eyebrow.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Hotel booking")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-run" })).toBeInTheDocument();
  });

  it("renders no eyebrow by default", () => {
    const { container } = render(<PageHeader title="Overview" />);

    expect(container.querySelector("[data-eyebrow]")).toBeNull();
  });
});
