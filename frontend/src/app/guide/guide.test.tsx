import { render, screen, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import { GUIDE_SECTIONS, type GuideSlug } from "@/features/guide/sections";
import Layout from "./layout";
import AutomationPage from "./automation/page";
import FaqPage from "./faq/page";
import GettingStartedPage from "./getting-started/page";
import HowItWorksPage from "./how-it-works/page";
import InterruptionsPage from "./interruptions-and-evaluator/page";
import ModulesPage from "./modules/page";
import OverviewPage from "./page";
import ScoringPage from "./scoring/page";

const PAGES: Record<GuideSlug, ComponentType> = {
  overview: OverviewPage,
  "getting-started": GettingStartedPage,
  "how-it-works": HowItWorksPage,
  modules: ModulesPage,
  scoring: ScoringPage,
  "interruptions-and-evaluator": InterruptionsPage,
  automation: AutomationPage,
  faq: FaqPage,
};

describe("Guide layout", () => {
  it("has the Duet brand, a link into the app and the Swagger reference", () => {
    render(
      <Layout params={Promise.resolve({})}>
        <p>content</p>
      </Layout>,
    );

    const header = screen.getByRole("banner");
    expect(within(header).getByText("Duet")).toBeInTheDocument();
    expect(within(header).getByRole("link", { name: "Open the app" })).toHaveAttribute("href", "/");
    const swagger = within(header).getByRole("link", { name: /API reference \(Swagger\)/ });
    expect(swagger).toHaveAttribute("href", "/api/docs");
    expect(swagger).toHaveAttribute("target", "_blank");
    expect(swagger).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});

describe("Guide index", () => {
  it("renders the section nav with a link to every section, marking the current one", () => {
    render(<OverviewPage />);

    const navs = screen.getAllByRole("navigation", { name: "Guide sections" });
    expect(navs.length).toBeGreaterThan(0);
    for (const nav of navs) {
      for (const item of GUIDE_SECTIONS) {
        expect(within(nav).getByRole("link", { name: item.title })).toHaveAttribute("href", item.href);
      }
      expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
      expect(within(nav).getByRole("link", { name: "Scoring" })).not.toHaveAttribute("aria-current");
    }
  });

  it("explains Duet and draws the end-to-end flow", () => {
    render(<OverviewPage />);

    expect(screen.getByRole("figure", { name: /From scenario to report/ })).toBeInTheDocument();
  });
});

describe.each(GUIDE_SECTIONS.map((item) => [item.slug, item] as const))("Guide page %s", (slug, item) => {
  it("renders its heading and links to its neighbours", () => {
    const Page = PAGES[slug];
    render(<Page />);

    expect(screen.getByRole("heading", { level: 1, name: item.title })).toBeInTheDocument();
    const pager = screen.getByRole("navigation", { name: "Previous and next section" });
    const index = GUIDE_SECTIONS.indexOf(item);
    const previous = GUIDE_SECTIONS[index - 1];
    const next = GUIDE_SECTIONS[index + 1];
    if (previous) expect(within(pager).getByRole("link", { name: `Previous: ${previous.title}` })).toHaveAttribute("href", previous.href);
    if (next) expect(within(pager).getByRole("link", { name: `Next: ${next.title}` })).toHaveAttribute("href", next.href);
  });
});

describe("Guide content", () => {
  it("shows the run lifecycle with the real run statuses", () => {
    render(<HowItWorksPage />);

    const lifecycle = screen.getByRole("figure", { name: /Run lifecycle/ });
    for (const status of ["Queued", "Connecting", "Running", "Completed", "Failed", "Cancelled", "Interrupted"]) {
      expect(within(lifecycle).getByText(status)).toBeInTheDocument();
    }
  });

  it("maps score bands to points and verdicts", () => {
    render(<ScoringPage />);

    const table = screen.getByRole("table", { name: /Bands, points and verdicts/ });
    for (const [band, points] of [["5", "100"], ["4", "90"], ["3", "70"], ["2", "50"], ["1", "25"]]) {
      expect(within(table).getByRole("row", { name: new RegExp(`^${band} .*${points}`) })).toBeInTheDocument();
    }
  });

  it("illustrates a barge-in", () => {
    render(<InterruptionsPage />);

    expect(screen.getByRole("figure", { name: /barge-in/i })).toBeInTheDocument();
  });

  it("explains the light and dark themes", () => {
    render(<FaqPage />);

    expect(screen.getByRole("heading", { level: 3, name: /light theme/i })).toBeInTheDocument();
    expect(screen.getByText(/System, Light or Dark/)).toBeInTheDocument();
  });

  it("defines the key terms in a glossary", () => {
    render(<FaqPage />);

    const glossary = screen.getByRole("region", { name: "Glossary" });
    for (const term of ["Scenario", "Batch", "Run", "Evaluator", "Agent", "Criterion", "Must criterion", "Judgement", "Brief", "Barge-in", "Thread ID"]) {
      expect(within(glossary).getByText(term, { selector: "dt" })).toBeInTheDocument();
    }
  });

  it("covers text agents next to voice agents", () => {
    const { unmount } = render(<OverviewPage />);
    expect(screen.getByRole("heading", { level: 2, name: "Voice and text agents" })).toBeInTheDocument();
    unmount();

    const started = render(<GettingStartedPage />);
    const textAgent = screen.getByRole("heading", { level: 2, name: /Adding a text agent/ });
    expect(textAgent).toHaveAttribute("id", "add-a-text-agent");
    expect(screen.getByText(/portal's testing channel/)).toBeInTheDocument();
    expect(screen.getAllByText("vivi-api-key").length).toBeGreaterThan(0);
    started.unmount();

    const how = render(<HowItWorksPage />);
    expect(screen.getByRole("heading", { level: 2, name: "Text agents: a chat instead of a call" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Common end reasons/ })).toHaveTextContent("Reached the maximum turns");
    how.unmount();

    const modules = render(<ModulesPage />);
    expect(screen.getAllByText(/text agent/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Follow and listen automatically")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Model prices" })).toBeInTheDocument();
    modules.unmount();

    const scoring = render(<ScoringPage />);
    expect(screen.getByRole("heading", { name: "Timing for text agents" })).toBeInTheDocument();
    scoring.unmount();

    render(<FaqPage />);
    for (const question of [/HTTP 403/, /HTTP 422/, /no on_chat_end/]) {
      expect(screen.getByRole("heading", { level: 3, name: question })).toBeInTheDocument();
    }
  });
});
