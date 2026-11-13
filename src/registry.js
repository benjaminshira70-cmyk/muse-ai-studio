import { validate } from "./util.js";

const tools = new Map();

export function registerTool(tool) {
  for (const k of ["name", "description", "input_schema", "handler"]) {
    if (!tool[k]) throw new Error(`Tool is missing "${k}"`);
  }
  if (tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
  tools.set(tool.name, tool);
}

/**
 * Tool definitions in the shape your model API expects.
 * "anthropic" -> { name, description, input_schema }
 * "openai"    -> { type: "function", function: { name, description, parameters } }
 */
export function listTools(format = "anthropic") {
  return [...tools.values()].map((t) =>
    format === "openai"
      ? { type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }
      : { name: t.name, description: t.description, input_schema: t.input_schema }
  );
}

export async function callTool(name, input, ctx = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  validate(tool.input_schema, input);
  return tool.handler(input, ctx);
}

/**
 * Safe wrapper for an agent loop: never throws, returns { ok, result | error }.
 * Feed JSON.stringify of this back to the model as the tool result.
 */
export async function callToolSafe(name, input, ctx = {}) {
  try {
    return { ok: true, result: await callTool(name, input, ctx) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
