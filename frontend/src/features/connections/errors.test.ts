import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { DUPLICATE_NAME, errorMessage, formErrorView } from "./errors";

const GENERIC = "Something went wrong. Try again.";

describe("formErrorView", () => {
  it("puts a duplicate name (409) on the name field", () => {
    expect(formErrorView(new ApiError(409, "Connection name already in use"))).toEqual({
      fieldErrors: { name: DUPLICATE_NAME },
    });
  });

  it("shows any other conflict (409) as a form-level message, not on the name", () => {
    const conflict = new ApiError(409, "Connection conflicts with a concurrent change; try again");
    expect(formErrorView(conflict)).toEqual({
      message: "Connection conflicts with a concurrent change; try again",
      fieldErrors: {},
    });
  });

  it("maps validation errors (422) to their fields with a summary message", () => {
    const fieldErrors = { "config.baseUrl": "URL must use https", "secrets.apiKey": "Field required" };
    expect(formErrorView(new ApiError(422, "Some fields need attention.", { fieldErrors }))).toEqual({
      message: "Check the highlighted fields.",
      fieldErrors,
    });
  });

  it.each([400, 401, 403, 404, 429, 500, 503, 0])("shows the API message for status %i", (status) => {
    expect(formErrorView(new ApiError(status, "Stored secret cannot be decrypted"))).toEqual({
      message: "Stored secret cannot be decrypted",
      fieldErrors: {},
    });
  });

  it.each([new Error("boom"), "boom", undefined])("falls back to a generic message for non-API errors", (error) => {
    expect(formErrorView(error)).toEqual({ message: GENERIC, fieldErrors: {} });
  });
});

describe("errorMessage", () => {
  it("uses the API message, or a generic one for anything else", () => {
    expect(errorMessage(new ApiError(500, "Provider error"))).toBe("Provider error");
    expect(errorMessage(new TypeError("Failed to fetch"))).toBe(GENERIC);
  });
});
