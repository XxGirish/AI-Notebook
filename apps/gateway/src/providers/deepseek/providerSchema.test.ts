import { describe, expect, it } from "vitest";
import { buildStrictProposalSchema, stripNullMembers } from "./providerSchema";

const ALLOWED = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "$ref", "$defs", "description", "pattern", "format"]);

function visitSchemas(schema: unknown, visit: (node: Record<string, unknown>) => void) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  const node = schema as Record<string, unknown>;
  visit(node);
  for (const [keyword, value] of Object.entries(node)) {
    if (keyword === "properties" || keyword === "$defs") Object.values(value as object).forEach((child) => visitSchemas(child, visit));
    else if (keyword === "items") visitSchemas(value, visit);
    else if (keyword === "anyOf") (value as unknown[]).forEach((child) => visitSchemas(child, visit));
  }
}

describe("strict provider schema", () => {
  const schema = buildStrictProposalSchema(new Set(["insert_explanation", "insert_equation"]));

  it("uses only documented strict keywords and requires every property", () => {
    visitSchemas(schema, (node) => {
      for (const keyword of Object.keys(node)) expect(ALLOWED.has(keyword), keyword).toBe(true);
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties as object));
      }
    });
  });

  it("offers only the permitted operation variants", () => {
    const operations = (schema.properties as Record<string, Record<string, unknown>>).operations;
    const variants = (operations.items as { anyOf: Array<{ properties: { type: { enum: string[] } } }> }).anyOf;
    expect(variants.map((variant) => variant.properties.type.enum[0])).toEqual(["insert_explanation", "insert_equation"]);
  });

  it("represents optional fields as nullable and strips the nulls again", () => {
    const serialized = JSON.stringify(schema);
    expect(serialized).toContain('"explanation":{"anyOf":[{"type":"string"},{"type":"null"}]}');
    expect(stripNullMembers({ a: null, b: [{ c: null, d: 1 }], e: "x" })).toEqual({ b: [{ d: 1 }], e: "x" });
  });
});
