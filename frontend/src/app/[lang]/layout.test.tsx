import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const root = vi.hoisted(() => ({ lang: "en" }));

vi.mock("next/root-params", () => ({ lang: async () => root.lang }));
vi.mock("next/font/google", () => ({
  Schibsted_Grotesk: () => ({ variable: "font-sans" }),
  JetBrains_Mono: () => ({ variable: "font-mono" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { default: RootLayout, generateStaticParams } = await import("./layout");

async function renderLayout() {
  return (await RootLayout({ children: null, params: Promise.resolve({ lang: root.lang }) } as never)) as ReactElement<{
    lang: string;
  }>;
}

beforeEach(() => {
  root.lang = "en";
});

describe("root layout", () => {
  it("prerenders every supported language", async () => {
    expect(await generateStaticParams()).toEqual([{ lang: "en" }, { lang: "es" }]);
  });

  it("sets <html lang> from the root param", async () => {
    expect((await renderLayout()).props.lang).toBe("en");
    root.lang = "es";
    expect((await renderLayout()).props.lang).toBe("es");
  });

  it("is a 404 for an unsupported language", async () => {
    root.lang = "fr";
    await expect(renderLayout()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
