import { render, screen, within } from "@testing-library/react";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { guideSections, type GuideSlug } from "@/features/guide/sections";
import Layout, { generateMetadata as layoutMetadata } from "./layout";
import AutomationPage, { generateMetadata as automationMetadata } from "./automation/page";
import FaqPage, { generateMetadata as faqMetadata } from "./faq/page";
import GettingStartedPage, { generateMetadata as gettingStartedMetadata } from "./getting-started/page";
import HowItWorksPage, { generateMetadata as howItWorksMetadata } from "./how-it-works/page";
import InterruptionsPage, { generateMetadata as interruptionsMetadata } from "./interruptions-and-evaluator/page";
import ModulesPage, { generateMetadata as modulesMetadata } from "./modules/page";
import OverviewPage, { generateMetadata as overviewMetadata } from "./page";
import ScoringPage, { generateMetadata as scoringMetadata } from "./scoring/page";

const root = vi.hoisted(() => ({ lang: "en" }));
vi.mock("next/root-params", () => ({ lang: async () => root.lang }));

beforeEach(() => {
  root.lang = "en";
});

type Page = () => Promise<ReactElement>;

const PAGES: Record<GuideSlug, { Page: Page; metadata: () => Promise<Metadata> }> = {
  overview: { Page: OverviewPage, metadata: overviewMetadata },
  "getting-started": { Page: GettingStartedPage, metadata: gettingStartedMetadata },
  "how-it-works": { Page: HowItWorksPage, metadata: howItWorksMetadata },
  modules: { Page: ModulesPage, metadata: modulesMetadata },
  scoring: { Page: ScoringPage, metadata: scoringMetadata },
  "interruptions-and-evaluator": { Page: InterruptionsPage, metadata: interruptionsMetadata },
  automation: { Page: AutomationPage, metadata: automationMetadata },
  faq: { Page: FaqPage, metadata: faqMetadata },
};

/** Server pages are async: resolve one in a language, then render its output. */
async function show(Page: Page, lang: "en" | "es" = "en") {
  root.lang = lang;
  return render(await Page());
}

const GUIDE_SECTIONS = guideSections("en");

describe("Guide layout", () => {
  it("has the TestForge brand, a link into the app and the Swagger reference", async () => {
    render(
      <Layout params={Promise.resolve({ lang: "en" })}>
        <p>content</p>
      </Layout>,
    );

    const header = screen.getByRole("banner");
    expect(within(header).getByText("TestForge")).toBeInTheDocument();
    expect(within(header).getByRole("link", { name: "Open the app" })).toHaveAttribute("href", "/");
    const swagger = within(header).getByRole("link", { name: /API reference \(Swagger\)/ });
    expect(swagger).toHaveAttribute("href", "/api/docs");
    expect(swagger).toHaveAttribute("target", "_blank");
    expect(swagger).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});

describe("Guide index", () => {
  it("renders the section nav with a link to every section, marking the current one", async () => {
    await show(OverviewPage);

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

  it("explains TestForge and draws the end-to-end flow", async () => {
    await show(OverviewPage);

    expect(screen.getByRole("figure", { name: /From scenario to report/ })).toBeInTheDocument();
  });
});

describe.each(GUIDE_SECTIONS.map((item) => [item.slug, item] as const))("Guide page %s", (slug, item) => {
  it("renders its heading and links to its neighbours", async () => {
    await show(PAGES[slug].Page);

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
  it("shows the run lifecycle with the real run statuses", async () => {
    await show(HowItWorksPage);

    const lifecycle = screen.getByRole("figure", { name: /Run lifecycle/ });
    for (const status of ["Queued", "Connecting", "Running", "Completed", "Failed", "Cancelled", "Interrupted"]) {
      expect(within(lifecycle).getByText(status)).toBeInTheDocument();
    }
  });

  it("maps score bands to points and verdicts", async () => {
    await show(ScoringPage);

    const table = screen.getByRole("table", { name: /Bands, points and verdicts/ });
    for (const [band, points] of [["5", "100"], ["4", "90"], ["3", "70"], ["2", "50"], ["1", "25"]]) {
      expect(within(table).getByRole("row", { name: new RegExp(`^${band} .*${points}`) })).toBeInTheDocument();
    }
  });

  it("illustrates a barge-in", async () => {
    await show(InterruptionsPage);

    expect(screen.getByRole("figure", { name: /barge-in/i })).toBeInTheDocument();
  });

  it("explains the light and dark themes and where to switch them", async () => {
    await show(FaqPage);

    expect(screen.getByRole("heading", { level: 3, name: /light theme/i })).toBeInTheDocument();
    const answer = screen.getByText(/System, Light or Dark/).closest("p");
    expect(answer).toHaveTextContent(/Settings → Preferences/);
    expect(answer).not.toHaveTextContent(/sidebar/);
  });

  it("says where to switch the app to Spanish", async () => {
    await show(FaqPage);

    expect(screen.getByRole("heading", { level: 3, name: /Spanish/ })).toBeInTheDocument();
    expect(screen.getByText(/EN or ES/).closest("p")).toHaveTextContent(/Settings → Preferences/);
  });

  it("defines the key terms in a glossary", async () => {
    await show(FaqPage);

    const glossary = screen.getByRole("region", { name: "Glossary" });
    for (const term of ["Scenario", "Batch", "Run", "Evaluator", "Agent", "Criterion", "Must criterion", "Judgement", "Brief", "Barge-in", "Thread ID"]) {
      expect(within(glossary).getByText(term, { selector: "dt" })).toBeInTheDocument();
    }
  });

  it("covers text agents next to voice agents", async () => {
    const { unmount } = await show(OverviewPage);
    expect(screen.getByRole("heading", { level: 2, name: "Voice and text agents" })).toBeInTheDocument();
    unmount();

    const started = await show(GettingStartedPage);
    const textAgent = screen.getByRole("heading", { level: 2, name: /Adding a text agent/ });
    expect(textAgent).toHaveAttribute("id", "add-a-text-agent");
    expect(screen.getByText(/portal's testing channel/)).toBeInTheDocument();
    expect(screen.getAllByText("vivi-api-key").length).toBeGreaterThan(0);
    started.unmount();

    const how = await show(HowItWorksPage);
    expect(screen.getByRole("heading", { level: 2, name: "Text agents: a chat instead of a call" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Common end reasons/ })).toHaveTextContent("Reached the maximum turns");
    how.unmount();

    const modules = await show(ModulesPage);
    expect(screen.getAllByText(/text agent/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Follow and listen automatically")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Model prices" })).toBeInTheDocument();
    expect(screen.getByText(/The sidebar of the app lists the main modules/)).toHaveTextContent(/Settings/);
    modules.unmount();

    const scoring = await show(ScoringPage);
    expect(screen.getByRole("heading", { name: "Timing for text agents" })).toBeInTheDocument();
    scoring.unmount();

    await show(FaqPage);
    for (const question of [/HTTP 403/, /HTTP 422/, /no on_chat_end/]) {
      expect(screen.getByRole("heading", { level: 3, name: question })).toBeInTheDocument();
    }
  });
});

describe("Guide in Spanish", () => {
  const SPANISH = guideSections("es");

  it("titles the layout in the page language", async () => {
    expect(await layoutMetadata()).toMatchObject({ title: { default: "TestForge guide" } });
    root.lang = "es";
    expect(await layoutMetadata()).toMatchObject({ title: { default: "Guía de TestForge" } });
  });

  describe.each(SPANISH.map((item) => [item.slug, item] as const))("page %s", (slug, item) => {
    it("renders its translated heading, nav and pager, and a Spanish title", async () => {
      await show(PAGES[slug].Page, "es");

      expect(screen.getByRole("heading", { level: 1, name: item.title })).toBeInTheDocument();
      expect(screen.getByText(item.summary)).toBeInTheDocument();
      for (const nav of screen.getAllByRole("navigation", { name: "Secciones de la guía" })) {
        expect(within(nav).getByRole("link", { name: item.title })).toHaveAttribute("aria-current", "page");
      }
      const pager = screen.getByRole("navigation", { name: "Sección anterior y siguiente" });
      const index = SPANISH.indexOf(item);
      const next = SPANISH[index + 1];
      if (next) expect(within(pager).getByRole("link", { name: `Siguiente: ${next.title}` })).toHaveAttribute("href", next.href);
      // No English chrome left behind.
      expect(screen.queryByRole("navigation", { name: "Guide sections" })).not.toBeInTheDocument();
      expect(screen.queryByText(/^(Tip|Note|Warning)(:|$)/)).not.toBeInTheDocument();

      root.lang = "es";
      expect(await PAGES[slug].metadata()).toEqual({
        title: { absolute: `${item.title} · Guía de TestForge` },
        description: item.summary,
      });
    });

    it("keeps the same section anchors as the English page", async () => {
      const ids = () =>
        Array.from(document.querySelectorAll("h2[id], h3[id]"))
          .map((heading) => heading.id)
          .sort();
      const english = await show(PAGES[slug].Page, "en");
      const englishIds = ids();
      english.unmount();
      await show(PAGES[slug].Page, "es");
      expect(ids()).toEqual(englishIds);
    });
  });

  it("translates the diagrams, mock-ups and tables", async () => {
    const overview = await show(OverviewPage, "es");
    expect(screen.getByRole("figure", { name: /Del escenario al reporte/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Agentes de voz y de texto" })).toBeInTheDocument();
    overview.unmount();

    const how = await show(HowItWorksPage, "es");
    const lifecycle = screen.getByRole("figure", { name: /Ciclo de vida de una corrida/ });
    for (const status of ["En cola", "Conectando", "En curso", "Completada", "Fallida", "Cancelada", "Interrumpida"]) {
      expect(within(lifecycle).getByText(status)).toBeInTheDocument();
    }
    expect(screen.getByRole("table", { name: /Motivos de fin frecuentes/ })).toHaveTextContent("Llegó al máximo de turnos");
    how.unmount();

    const scoring = await show(ScoringPage, "es");
    const bands = screen.getByRole("table", { name: /Bandas, puntos y veredictos/ });
    expect(within(bands).getAllByText("Cumple")).toHaveLength(2);
    expect(screen.getByRole("img", { name: /Ejemplo de tabla de criterios/ })).toHaveTextContent("Obligatorio");
    scoring.unmount();

    const interruptions = await show(InterruptionsPage, "es");
    expect(screen.getByRole("figure", { name: /Anatomía de una interrupción/ })).toBeInTheDocument();
    interruptions.unmount();

    const started = await show(GettingStartedPage, "es");
    expect(screen.getByRole("img", { name: /panel de lanzamiento/ })).toHaveTextContent("Lanzar 3 corridas");
    expect(screen.getAllByText("vivi-api-key").length).toBeGreaterThan(0);
    started.unmount();
  });

  it.each([
    {
      lang: "en" as const,
      facts: [
        /Newest first.*Oldest first.*kept in the URL/,
        /only when the run did not complete normally/,
        /1280 px/,
        /full run ID with a copy button/,
        /Open traces in Langfuse.*filtered on the run's thread ID/,
        /words appear in its bubble as they are said/,
        /Scenarios live in groups.*New scenario.*new, blank group.*pencil/,
        /trash icon on a key's row revokes it/,
      ],
    },
    {
      lang: "es" as const,
      facts: [
        /Más recientes primero.*Más antiguas primero.*se guardan en la URL/,
        /solo cuando la corrida no terminó con normalidad/,
        /1280 px/,
        /ID completo de la corrida con un botón para copiarlo/,
        /Abrir trazas en Langfuse.*filtrada por el ID del hilo/,
        /palabras aparecen en su burbuja a medida que las dice/,
        /Los escenarios viven en grupos.*Nuevo escenario.*grupo nuevo y en blanco.*lápiz/,
        /ícono de papelera en la fila de una clave la revoca/,
      ],
    },
  ])("describes the runs list, report, live, scenario and API key controls ($lang)", async ({ lang, facts }) => {
    const { container } = await show(ModulesPage, lang);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    for (const fact of facts) expect(text).toMatch(fact);
  });

  it.each([
    {
      lang: "en" as const,
      heading: "API flows",
      figure: /Example run of a flow/,
      facts: [
        /An API holds a base URL.*named secrets/,
        /A flow is one or more calls in order/,
        /Fixed.*Flow input.*API secret.*From a step.*AI generated/,
        /Run flow opens a small form.*leave an AI input empty and AI writes it/,
        /opens on the first failed step/,
        /fetched only when you click it and hidden again/,
        /Copy cURL copies what you see/,
        /Agents find, read and run flows through the API/,
      ],
    },
    {
      lang: "es" as const,
      heading: "Flujos de API",
      figure: /Ejemplo de una corrida de un flujo/,
      facts: [
        /Una API tiene una URL base.*secretos con nombre/,
        /Un flujo es una o más llamadas en orden/,
        /Fijo.*Entrada del flujo.*Secreto de la API.*De un paso.*Generado por IA/,
        /Ejecutar flujo abre un formulario pequeño.*deja vacía una entrada de IA y la IA la escribe/,
        /Abre en el primer paso fallido/,
        /se piden solo cuando haces clic y se ocultan otra vez/,
        /Copiar cURL copia lo que ves/,
        /Los agentes encuentran, leen y ejecutan flujos por la API/,
      ],
    },
  ])("explains API flows, their runs, the eye and Copy cURL ($lang)", async ({ lang, heading, figure, facts }) => {
    const { container } = await show(ModulesPage, lang);
    const region = screen.getByRole("region", { name: heading });
    expect(screen.getByRole("heading", { level: 2, name: heading })).toHaveAttribute("id", "api-flows");
    expect(within(region).getByRole("figure", { name: figure })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: lang === "en" ? "Modules on this page" : /módulos/i })).toBeInTheDocument();
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    for (const fact of facts) expect(text).toMatch(fact);
  });

  it("answers the Preferences questions and defines the glossary in Spanish", async () => {
    await show(FaqPage, "es");

    expect(screen.getByRole("heading", { level: 3, name: /tema claro/i })).toBeInTheDocument();
    expect(screen.getByText(/Sistema, Claro u Oscuro/).closest("p")).toHaveTextContent(/Configuración → Preferencias/);
    expect(screen.getByText(/EN o ES/).closest("p")).toHaveTextContent(/Configuración → Preferencias/);
    const glossary = screen.getByRole("region", { name: "Glosario" });
    for (const term of ["Escenario", "Lote", "Corrida", "Evaluador", "Agente", "Criterio", "Criterio obligatorio", "Evaluación del juez", "Informe", "ID del hilo"]) {
      expect(within(glossary).getByText(term, { selector: "dt" })).toBeInTheDocument();
    }
  });
});
