import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createGatewayApp } from "./app";
import { ConfigError, describeConfig, loadConfig } from "./config";
import { GenerationLimiter } from "./limits";
import { DeepSeekProvider } from "./providers/deepseek/deepseekProvider";
import { MockProvider } from "./providers/mockProvider";
import type { AiProvider } from "./providers/types";

if (existsSync(".env")) process.loadEnvFile(".env");

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Gateway configuration error: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

const provider: AiProvider = config.deepseek ? new DeepSeekProvider(config.deepseek) : new MockProvider();
const app = createGatewayApp({
  provider,
  limiter: new GenerationLimiter(config.limits),
  accessToken: config.accessToken,
  generationTimeoutMs: config.generationTimeoutMs,
  log: (record) => console.info(JSON.stringify(record)),
});

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.info(JSON.stringify({ event: "gateway_started", ...describeConfig(config), port: info.port }));
});
