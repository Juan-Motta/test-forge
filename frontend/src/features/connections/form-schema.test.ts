import { describe, expect, it } from "vitest";
import { draftIssues, hasTypedSecret, initialValues, toChanges, toDraft, type ConnectionFormValues } from "./form-schema";
import { connectionFixture } from "./testing";

const KEY = "sk-proj-abcdefghijklmnop1234";

function openaiValues(secret: string): ConnectionFormValues {
  return { ...initialValues(), name: "Main", secrets: { apiKey: secret } };
}

const secretIssues = (values: ConnectionFormValues, secretRequired: boolean) =>
  draftIssues(values, { secretRequired }).filter((issue) => issue.path === "secrets.apiKey");

describe("secret presence and whitespace", () => {
  it.each(["", "   ", "\t \n"])("requires a secret on create when it is blank (%j)", (secret) => {
    expect(secretIssues(openaiValues(secret), true)).toEqual([
      { path: "secrets.apiKey", message: "Enter the API key." },
    ]);
  });

  it.each(["", "   ", "\t \n"])("keeps the stored secret on edit when the field is blank (%j)", (secret) => {
    const connection = connectionFixture();
    const values = { ...initialValues(connection), secrets: { apiKey: secret } };

    expect(secretIssues(values, false)).toEqual([]);
    expect(hasTypedSecret(values)).toBe(false);
    expect(toChanges(connection, values)).toEqual({});
    expect(toDraft(values).secrets).toEqual({});
  });

  it.each([` ${KEY}`, `${KEY} `, `${KEY}\n`])("rejects a secret that starts or ends with whitespace (%j)", (secret) => {
    for (const secretRequired of [true, false]) {
      expect(secretIssues(openaiValues(secret), secretRequired)).toEqual([
        { path: "secrets.apiKey", message: "The API key must not start or end with spaces or line breaks." },
      ]);
    }
  });

  it.each(["sk key-with-space", "clé-secrète-1234", "sk-tab\tinside"])(
    "rejects characters that cannot travel in an HTTP header (%j)",
    (secret) => {
      expect(secretIssues(openaiValues(secret), true)).toEqual([
        {
          path: "secrets.apiKey",
          message: "The API key may contain only printable ASCII characters, without spaces.",
        },
      ]);
    },
  );

  it("sends a valid secret exactly as typed", () => {
    const values = openaiValues(KEY);
    expect(secretIssues(values, true)).toEqual([]);
    expect(toDraft(values).secrets).toEqual({ apiKey: KEY });
  });
});
