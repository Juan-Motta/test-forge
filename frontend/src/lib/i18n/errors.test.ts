import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { localErrorMessage, localizeFormError } from "./errors";
import { createTranslator } from "./translate";

const en = createTranslator("en");
const es = createTranslator("es");
const view = { message: "Name already in use", fieldErrors: { name: "Taken" } };

describe("localizeFormError", () => {
  it("replaces a non-API failure with the generic error in the page language", () => {
    expect(localizeFormError(en, new TypeError("Failed to fetch"), view)).toEqual({
      message: "Something went wrong. Try again.",
      fieldErrors: { name: "Taken" },
    });
    const spanish = localizeFormError(es, new TypeError("Failed to fetch"), view);
    expect(spanish.message).toBe("Algo salió mal. Vuelve a intentarlo.");
  });

  it("asks to check the fields on a 422, keeping the field errors", () => {
    const error = new ApiError(422, "Validation failed", { fieldErrors: { name: "Required" } });
    const fields = { message: "Validation failed", fieldErrors: { name: "Required" } };
    expect(localizeFormError(en, error, fields)).toEqual({ ...fields, message: "Check the highlighted fields." });
    expect(localizeFormError(es, error, fields)).toEqual({ ...fields, message: "Revisa los campos marcados." });
  });

  it("passes any other API error's view through as the server wrote it", () => {
    const error = new ApiError(409, "Name already in use");
    expect(localizeFormError(en, error, view)).toBe(view);
    expect(localizeFormError(es, error, view)).toBe(view);
  });
});

describe("localErrorMessage", () => {
  it("uses the API's own message", () => {
    expect(localErrorMessage(en, new ApiError(500, "Database unavailable"))).toBe("Database unavailable");
    expect(localErrorMessage(es, new ApiError(500, "Database unavailable"))).toBe("Database unavailable");
  });

  it("falls back to the generic error in the page language for anything else", () => {
    expect(localErrorMessage(en, new Error("boom"))).toBe("Something went wrong. Try again.");
    expect(localErrorMessage(es, "boom")).toBe("Algo salió mal. Vuelve a intentarlo.");
  });
});
