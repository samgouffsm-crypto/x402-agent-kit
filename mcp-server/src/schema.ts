// Converts the subset of JSON Schema used by our tool definitions into zod v3
// schemas (the MCP SDK accepts zod v3 raw shapes for tool inputSchema).
import { z } from "zod";

export type JsonSchema = {
  type?: string;
  description?: string;
  enum?: (string | number)[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  [k: string]: unknown;
};

export function jsonSchemaToZod(schema: JsonSchema): z.ZodTypeAny {
  let out: z.ZodTypeAny;
  if (schema.enum && schema.enum.length > 0) {
    // Keep it permissive: string enums in our specs are filters, not strict sets.
    out = z.string();
  } else {
    switch (schema.type) {
      case "string":
        out = z.string();
        break;
      case "integer":
        out = z.number().int();
        break;
      case "number":
        out = z.number();
        break;
      case "boolean":
        out = z.boolean();
        break;
      case "array":
        out = z.array(
          schema.items ? jsonSchemaToZod(schema.items) : z.unknown()
        );
        break;
      case "object":
        if (schema.properties && Object.keys(schema.properties).length > 0) {
          const shape: Record<string, z.ZodTypeAny> = {};
          for (const [k, v] of Object.entries(schema.properties)) {
            let s = jsonSchemaToZod(v);
            if (!(schema.required || []).includes(k)) s = s.optional();
            shape[k] = s;
          }
          out = z.object(shape).passthrough();
        } else {
          // Free-form object (e.g. a normalized opportunity record).
          out = z.record(z.unknown());
        }
        break;
      default:
        out = z.unknown();
    }
  }
  if (schema.description) out = out.describe(schema.description);
  return out;
}

/** Build the zod raw shape for a tool's top-level input object schema. */
export function inputShapeFor(schema: JsonSchema): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, v] of Object.entries(schema.properties || {})) {
    let s = jsonSchemaToZod(v);
    if (!(schema.required || []).includes(k)) s = s.optional();
    shape[k] = s;
  }
  return shape;
}
