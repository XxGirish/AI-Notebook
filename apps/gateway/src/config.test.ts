import { describe, expect, it } from "vitest";
import { describeConfig, loadConfig } from "./config";

const token = "t".repeat(40);

describe("gateway configuration", () => {
  it("defaults to the mock provider on loopback without credentials", () => {
    expect(loadConfig({})).toMatchObject({ provider: "mock", host: "127.0.0.1", port: 8787, deepseek: undefined });
  });

  it("requires a DeepSeek key and an access token for the live provider", () => {
    expect(() => loadConfig({ AI_PROVIDER: "deepseek", GATEWAY_ACCESS_TOKEN: token })).toThrow("DEEPSEEK_API_KEY");
    expect(() => loadConfig({ AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "sk-live" })).toThrow("GATEWAY_ACCESS_TOKEN");
    expect(() => loadConfig({ GATEWAY_HOST: "0.0.0.0" })).toThrow("GATEWAY_ACCESS_TOKEN");
  });

  it("rejects insecure provider URLs and never includes secrets in descriptions or errors", () => {
    let message = "";
    try {
      loadConfig({ DEEPSEEK_BASE_URL: "http://api.deepseek.com", GATEWAY_ACCESS_TOKEN: "short-secret-value" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("DEEPSEEK_BASE_URL");
    expect(message).not.toContain("short-secret-value");

    const config = loadConfig({ AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "sk-live-secret", GATEWAY_ACCESS_TOKEN: token });
    expect(config.deepseek).toMatchObject({ model: "deepseek-flash", outputMode: "json_object" });
    const described = JSON.stringify(describeConfig(config));
    expect(described).not.toContain("sk-live-secret");
    expect(described).not.toContain(token);
  });
});
