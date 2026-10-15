import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n";
import { parseAgentCurl } from "./curl-import";

const t = createTranslator("en");

// Copied verbatim from Safari's "Copy as cURL" on a vivi.bot realtime socket.
const SAFARI_SAMPLE = `curl 'wss://api-dev-95a8b1f8-0925-4b65-a078-75c0473d54d7.vivi.bot/channelApi/2a8204d3-bd82-4799-a8e8-8e669f318fec/realtime?voiceCapability=live-v1&userId=waad%7CKSG%7Cdef6b5db-b7ad-4888-bcb3-6ce1c16e2ead&threadId=1786f832-77e7-4b1b-9ea6-ecc7982ce73f' \\
-X 'GET' \\
-H 'Origin: https://portal-dev-95a8b1f8-0925-4b65-a078-75c0473d54d7.vivi.bot' \\
-H 'Pragma: no-cache' \\
-H 'Sec-WebSocket-Version: 13' \\
-H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15'`;

function parsed(text: string) {
  const result = parseAgentCurl(t, text);
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result;
}

describe("parseAgentCurl", () => {
  it("reads the connection fields from a real browser cURL", () => {
    const result = parsed(SAFARI_SAMPLE);

    expect(result.values).toEqual({
      baseUrl: "wss://api-dev-95a8b1f8-0925-4b65-a078-75c0473d54d7.vivi.bot",
      channelId: "2a8204d3-bd82-4799-a8e8-8e669f318fec",
      userId: "waad|KSG|def6b5db-b7ad-4888-bcb3-6ce1c16e2ead",
      origin: "https://portal-dev-95a8b1f8-0925-4b65-a078-75c0473d54d7.vivi.bot",
    });
    expect(result.ignored).toEqual(expect.arrayContaining(["voiceCapability", "threadId"]));
    expect(result.warnings).toEqual([]);
  });

  it("never fills name, context, protocol or Langfuse", () => {
    const { values } = parsed(SAFARI_SAMPLE);
    expect(Object.keys(values).sort()).toEqual(["baseUrl", "channelId", "origin", "userId"]);
  });

  it("accepts double quotes, --header, --compressed and a single line", () => {
    const result = parsed(
      'curl --compressed "wss://agent.example.com:8443/channelApi/chan%2E1/realtime?userId=u%7C1" --header "origin: https://app.example.com:9000/some/path" -H "Accept: */*"',
    );

    expect(result.values).toEqual({
      baseUrl: "wss://agent.example.com:8443",
      channelId: "chan.1",
      userId: "u|1",
      origin: "https://app.example.com:9000",
    });
  });

  it("converts https to wss and http to ws", () => {
    expect(parsed("curl 'https://a.example.com/channelApi/c/realtime?userId=u'").values.baseUrl).toBe(
      "wss://a.example.com",
    );
    expect(parsed("curl 'http://localhost:8080/channelApi/c/realtime?userId=u'").values.baseUrl).toBe(
      "ws://localhost:8080",
    );
  });

  it("reports unknown query parameters as ignored", () => {
    const result = parsed("curl 'wss://a.example.com/channelApi/c/realtime?userId=u&debug=1'");
    expect(result.ignored).toEqual(["debug"]);
  });

  it("fills what it found and warns when the user ID is missing", () => {
    const result = parsed("curl 'wss://a.example.com/channelApi/c/realtime?threadId=t'");

    expect(result.values).toEqual({ baseUrl: "wss://a.example.com", channelId: "c" });
    expect(result.warnings).toEqual(["No userId query parameter; enter the user ID yourself."]);
  });

  it("keeps the host but warns when the path is not /channelApi/{channelId}/realtime", () => {
    const result = parsed("curl 'wss://a.example.com/channelapi/c/live?userId=u'");

    expect(result.values).toEqual({ baseUrl: "wss://a.example.com", userId: "u" });
    expect(result.warnings).toEqual([
      "The path /channelapi/c/live is not /channelApi/{channelId}/realtime; enter the channel ID yourself.",
    ]);
  });

  it("does not take a URL-looking header or referer value as the socket URL", () => {
    const result = parsed(
      "curl -e 'https://referer.example.com' -H 'Origin: https://app.example.com' 'wss://a.example.com/channelApi/c/realtime?userId=u'",
    );
    expect(result.values.baseUrl).toBe("wss://a.example.com");
  });

  it.each([
    ["", "Paste a cURL command."],
    ["   ", "Paste a cURL command."],
    ["curl -X GET -H 'Pragma: no-cache'", "No ws://, wss://, http:// or https:// URL found in the command."],
    ["curl 'ftp://a.example.com/x'", "No ws://, wss://, http:// or https:// URL found in the command."],
    ["curl 'wss://'", "Could not read the URL wss://."],
  ])("fails on %j", (text, error) => {
    expect(parseAgentCurl(t, text)).toEqual({ ok: false, error });
  });
  it("keeps ws:// for a local agent and its http Origin", () => {
    const result = parsed(
      "curl 'ws://localhost:8000/channelApi/2a8204d3-bd82-4799-a8e8-8e669f318fec/realtime?userId=u%7Clocal&threadId=t-1' -H 'Origin: http://localhost:3001'",
    );
    expect(result.values).toEqual({
      baseUrl: "ws://localhost:8000",
      channelId: "2a8204d3-bd82-4799-a8e8-8e669f318fec",
      userId: "u|local",
      origin: "http://localhost:3001",
    });
    expect(result.ignored).toEqual(["threadId"]);
    expect(result.warnings).toEqual([]);
  });

  it("reports a voice agent for a realtime socket", () => {
    expect(parsed(SAFARI_SAMPLE).kind).toBe("voice");
  });
});

// The shape of a portal testing-channel request copied from the browser (WEB channel, no key).
const TEXT_STREAM_SAMPLE = `curl 'https://api-dev.vivi.bot/channelsApi/2A8204D3-bd82-4799-a8e8-8e669f318fec/stream' \\
  -H 'accept: text/event-stream' \\
  -H 'content-type: application/json' \\
  -H 'origin: https://portal-dev.vivi.bot' \\
  -H 'referer: https://portal-dev.vivi.bot/' \\
  --data-raw '{"message":"hi","threadId":"1786f832-77e7-4b1b-9ea6-ecc7982ce73f","userId":"waad|KSG|1","pageUrl":"https://portal-dev.vivi.bot/agents"}'`;

describe("parseAgentCurl for text agents", () => {
  it("reads a stream request without credentials as a text agent with no auth", () => {
    const result = parsed(TEXT_STREAM_SAMPLE);

    expect(result.kind).toBe("text");
    expect(result.values).toEqual({
      baseUrl: "https://api-dev.vivi.bot",
      channelId: "2A8204D3-bd82-4799-a8e8-8e669f318fec",
      textMode: "stream",
      auth: "none",
      origin: "https://portal-dev.vivi.bot",
    });
    expect(result.warnings).toEqual([]);
  });

  it("reads an invoke request with a vivi-api-key header as an API channel", () => {
    const result = parsed(
      "curl -X POST 'https://api.example.com/channelsApi/2a8204d3-bd82-4799-a8e8-8e669f318fec/invoke' -H 'Content-Type: application/json' -H 'vivi-api-key: sk-test-1234' -d '{\"message\":\"hi\"}'",
    );

    expect(result.kind).toBe("text");
    expect(result.values).toEqual({
      baseUrl: "https://api.example.com",
      channelId: "2a8204d3-bd82-4799-a8e8-8e669f318fec",
      textMode: "invoke",
      auth: "api_key",
      apiKey: "sk-test-1234",
    });
  });

  it("keeps http for a local agent and the path prefix before /channelsApi", () => {
    const result = parsed("curl 'http://localhost:8000/api/channelsApi/c0ffee00-0000-4000-8000-000000000001/stream'");

    expect(result.values.baseUrl).toBe("http://localhost:8000/api");
    expect(result.values.textMode).toBe("stream");
  });

  it("never puts the API key in the warnings or ignored lists", () => {
    const result = parsed(
      "curl 'https://api.example.com/channelsApi/2a8204d3-bd82-4799-a8e8-8e669f318fec/invoke?debug=1' -H 'vivi-api-key: sk-secret-9'",
    );
    expect(JSON.stringify([result.warnings, result.ignored])).not.toContain("sk-secret-9");
  });
});
