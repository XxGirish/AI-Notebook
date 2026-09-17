import { z } from "zod";
import { CanvasProposalSchema, type SemanticOperationType } from "@ai-notebook/ai-contract";

type JsonSchema = { [key: string]: unknown };

// Keywords DeepSeek documents for strict tool schemas (checked 2026-09-17).
// Everything else, including length/count/range limits, is removed here and
// enforced by the full application validator instead. Sending an undocumented
// keyword that happens not to error would not prove the provider enforces it.
const ALLOWED_KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "$ref", "$defs", "description", "pattern", "format"]);
const ALLOWED_FORMATS = new Set(["email", "hostname", "ipv4", "ipv6", "uuid"]);

function isObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function convert(schema: unknown): JsonSchema {
  if (!isObject(schema)) throw new Error("Unsupported JSON Schema node");
  const source: JsonSchema = { ...schema };
  if ("const" in source) {
    source.enum = [source.const];
    delete source.const;
  }
  if (Array.isArray(source.oneOf)) {
    source.anyOf = source.oneOf;
    delete source.oneOf;
  }
  if (source.format !== undefined && !ALLOWED_FORMATS.has(String(source.format))) delete source.format;

  const result: JsonSchema = {};
  for (const [keyword, value] of Object.entries(source)) {
    if (!ALLOWED_KEYWORDS.has(keyword)) continue;
    if (keyword === "properties" && isObject(value)) {
      const required = new Set(Array.isArray(source.required) ? source.required as string[] : []);
      const properties: JsonSchema = {};
      for (const [name, property] of Object.entries(value)) {
        const converted = convert(property);
        // Strict mode requires every property; an optional field becomes nullable
        // and nulls are removed again before application validation.
        properties[name] = required.has(name) ? converted : { anyOf: [converted, { type: "null" }] };
      }
      result.properties = properties;
      result.required = Object.keys(value);
      result.additionalProperties = false;
    } else if (keyword === "items") {
      result.items = convert(value);
    } else if (keyword === "anyOf" && Array.isArray(value)) {
      result.anyOf = value.map(convert);
    } else if (keyword === "$defs" && isObject(value)) {
      result.$defs = Object.fromEntries(Object.entries(value).map(([name, definition]) => [name, convert(definition)]));
    } else if (keyword !== "required" && keyword !== "additionalProperties") {
      result[keyword] = value;
    }
  }
  if (result.type === "object" && !("properties" in result)) {
    result.properties = {};
    result.required = [];
    result.additionalProperties = false;
  }
  return result;
}

/**
 * Builds the strict `propose_canvas_patch` parameter schema for one request.
 * Operation variants the request does not permit are omitted so the model is
 * not invited to produce them; the application still rejects them if it does.
 */
export function buildStrictProposalSchema(permitted: ReadonlySet<SemanticOperationType>): JsonSchema {
  const schema = convert(z.toJSONSchema(CanvasProposalSchema, { io: "input", unrepresentable: "any" }));
  const operations = (schema.properties as JsonSchema).operations as JsonSchema;
  const items = operations.items as JsonSchema;
  const variants = (items.anyOf as JsonSchema[]).filter((variant) => {
    const type = ((variant.properties as JsonSchema).type as JsonSchema).enum as unknown[];
    return permitted.has(type[0] as SemanticOperationType);
  });
  if (variants.length === 0) throw new Error("No permitted operations for the provider schema");
  operations.items = variants.length === 1 ? variants[0] : { anyOf: variants };
  return schema;
}

/** Removes `null` object members produced for optional strict-schema fields. */
export function stripNullMembers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNullMembers);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, member]) => member !== null).map(([key, member]) => [key, stripNullMembers(member)]));
}
