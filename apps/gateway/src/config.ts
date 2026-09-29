import { z } from "zod";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const integer = (fallback: number, minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum).default(fallback);

const envSchema = z.object({
  AI_PROVIDER: z.enum(["mock", "deepseek"]).default("mock"),
  DEEPSEEK_API_KEY: z.string().trim().min(1).optional(),
  DEEPSEEK_MODEL: z.string().trim().min(1).max(100).default("deepseek-flash"),
  DEEPSEEK_BASE_URL: z.url({ protocol: /^https$/ }).default("https://api.deepseek.com"),
  DEEPSEEK_BETA_BASE_URL: z.url({ protocol: /^https$/ }).default("https://api.deepseek.com/beta"),
  // JSON Output is the default on measured evidence, not preference: on the
  // 57-case prompt set, strict function mode returned structurally malformed
  // JSON (mismatched brackets) on 7 cases that JSON Output answered correctly,
  // and cost more tokens and latency for the same work. See
  // docs/decisions/0012-json-output-and-prompt-v2.md. Strict mode stays
  // configurable so the comparison can be run again on a newer model.
  DEEPSEEK_OUTPUT_MODE: z.enum(["strict_tool", "json_object"]).default("json_object"),
  DEEPSEEK_MAX_OUTPUT_TOKENS: integer(6_000, 256, 32_000),
  GATEWAY_ACCESS_TOKEN: z.string().min(32, "GATEWAY_ACCESS_TOKEN must be at least 32 characters").optional(),
  GATEWAY_HOST: z.string().trim().min(1).default("127.0.0.1"),
  GATEWAY_PORT: integer(8787, 1, 65_535),
  GENERATION_TIMEOUT_MS: integer(90_000, 5_000, 600_000),
  RATE_LIMIT_PER_MINUTE: integer(6, 1, 120),
  DAILY_REQUEST_LIMIT: integer(200, 1, 100_000),
  DAILY_TOKEN_LIMIT: integer(400_000, 1_000, 100_000_000),
});

export type GatewayConfig = {
  provider: "mock" | "deepseek";
  deepseek?: {
    apiKey: string;
    model: string;
    baseUrl: string;
    betaBaseUrl: string;
    outputMode: "strict_tool" | "json_object";
    maxOutputTokens: number;
  };
  accessToken?: string;
  host: string;
  port: number;
  generationTimeoutMs: number;
  limits: { requestsPerMinute: number; dailyRequests: number; dailyTokens: number };
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Reads server-only configuration. Secrets stay in this object and are never
 * returned by `describeConfig`, health checks, capabilities, or logs.
 */
export function loadConfig(env: Record<string, string | undefined>): GatewayConfig {
  const blankToUndefined = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value === "" ? undefined : value]));
  const parsed = envSchema.safeParse(blankToUndefined);
  if (!parsed.success) {
    // Report only variable names and rule messages, never submitted values.
    throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  const values = parsed.data;
  const loopback = LOOPBACK_HOSTS.has(values.GATEWAY_HOST);

  if (values.AI_PROVIDER === "deepseek" && !values.DEEPSEEK_API_KEY) {
    throw new ConfigError("DEEPSEEK_API_KEY is required when AI_PROVIDER=deepseek");
  }
  if (!values.GATEWAY_ACCESS_TOKEN && (values.AI_PROVIDER === "deepseek" || !loopback)) {
    throw new ConfigError("GATEWAY_ACCESS_TOKEN is required for the DeepSeek provider or a non-loopback GATEWAY_HOST");
  }

  return {
    provider: values.AI_PROVIDER,
    deepseek: values.AI_PROVIDER === "deepseek" ? {
      apiKey: values.DEEPSEEK_API_KEY!,
      model: values.DEEPSEEK_MODEL,
      baseUrl: values.DEEPSEEK_BASE_URL,
      betaBaseUrl: values.DEEPSEEK_BETA_BASE_URL,
      outputMode: values.DEEPSEEK_OUTPUT_MODE,
      maxOutputTokens: values.DEEPSEEK_MAX_OUTPUT_TOKENS,
    } : undefined,
    accessToken: values.GATEWAY_ACCESS_TOKEN,
    host: values.GATEWAY_HOST,
    port: values.GATEWAY_PORT,
    generationTimeoutMs: values.GENERATION_TIMEOUT_MS,
    limits: {
      requestsPerMinute: values.RATE_LIMIT_PER_MINUTE,
      dailyRequests: values.DAILY_REQUEST_LIMIT,
      dailyTokens: values.DAILY_TOKEN_LIMIT,
    },
  };
}

export function describeConfig(config: GatewayConfig) {
  return {
    provider: config.provider,
    model: config.deepseek?.model,
    outputMode: config.deepseek?.outputMode,
    accessTokenConfigured: Boolean(config.accessToken),
    host: config.host,
    port: config.port,
    generationTimeoutMs: config.generationTimeoutMs,
    limits: config.limits,
  };
}
