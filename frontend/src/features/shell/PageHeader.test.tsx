import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders the breadcrumb links to the parent pages above the title, the description and the actions", () => {
    render(
      <PageHeader
        breadcrumbs={[
          { label: "Runs & reports", href: "/runs" },
          { label: "Batch b-1", href: "/runs?batchId=b-1" },
        ]}
        title="Booking with date change"
        description="Hotel booking"
        actions={<button type="button">Re-run</button>}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Booking with date change" });
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(breadcrumb).toHaveTextContent("Runs & reports / Batch b-1");
    const links = within(breadcrumb).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/runs", "/runs?batchId=b-1"]);
    // The title already names the current page; the breadcrumb only leads back.
    expect(breadcrumb).not.toHaveTextContent("Booking with date change");
    expect(screen.getByText("Hotel booking")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-run" })).toBeInTheDocument();
  });

  it("renders no breadcrumb on a top-level page", () => {
    render(<PageHeader title="Overview" />);

    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
  });
});
