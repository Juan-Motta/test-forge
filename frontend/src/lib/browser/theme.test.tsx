import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY, setTheme, useTheme } from "./theme";

const root = () => document.documentElement;

beforeEach(() => {
  setTheme("system");
  window.localStorage.clear();
  root().removeAttribute("data-theme");
});

describe("useTheme", () => {
  it("starts on System with no saved choice and no data-theme", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("system");
    expect(root()).not.toHaveAttribute("data-theme");
  });

  it("reads the saved choice", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("light");
  });

  it("ignores an unknown saved value", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("system");
  });

  it("persists Light and Dark and sets data-theme on <html>", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]("light"));
    expect(result.current[0]).toBe("light");
    expect(root()).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    act(() => result.current[1]("dark"));
    expect(root()).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("System removes data-theme and the saved choice", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]("dark"));
    act(() => result.current[1]("system"));
    expect(result.current[0]).toBe("system");
    expect(root()).not.toHaveAttribute("data-theme");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("still switches the page when the browser storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("system");
    act(() => result.current[1]("light"));
    expect(result.current[0]).toBe("light");
    expect(root()).toHaveAttribute("data-theme", "light");
  });
});

describe("THEME_INIT_SCRIPT", () => {
  it("applies a saved choice before React runs and leaves System alone", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(THEME_INIT_SCRIPT)();
    expect(root()).toHaveAttribute("data-theme", "dark");

    root().removeAttribute("data-theme");
    window.localStorage.setItem(THEME_STORAGE_KEY, "bogus");
    new Function(THEME_INIT_SCRIPT)();
    expect(root()).not.toHaveAttribute("data-theme");
  });

  it("does not throw when the browser storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => new Function(THEME_INIT_SCRIPT)()).not.toThrow();
  });
});
