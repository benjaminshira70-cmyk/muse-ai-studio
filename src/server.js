#!/usr/bin/env node
// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0). No dependencies.
// stdout is reserved for protocol messages; logs go to stderr.
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { listTools, callToolSafe } from "./index.js";

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const workDir = path.resolve(process.env.MUSE_WORKSPACE || path.join(os.homedir(), "muse-workspace"));

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return reply(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "muse-ai-studio", version: "0.1.0" },
        instructions:
          "Tools to build websites, generate images and videos, and edit videos. All files live in the server's workspace folder; pass the returned relative paths between tools.",
      });
    }
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: listTools("anthropic").map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
    case "tools/call": {
      const res = await callToolSafe(params?.name, params?.arguments ?? {}, { workDir });
      return reply(id, {
        content: [{ type: "text", text: JSON.stringify(res.ok ? res.result : { error: res.error }, null, 2) }],
        isError: !res.ok,
      });
    }
    default:
      if (isRequest) return fail(id, -32601, `Method not found: ${method}`);
      // notifications (e.g. notifications/initialized) need no reply
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, "Parse error");
  }
  try {
    await handle(msg);
  } catch (e) {
    if (msg.id !== undefined) fail(msg.id, -32603, e.message);
    else console.error("notification error:", e.message);
  }
});
rl.on("close", () => process.exit(0));
console.error(`muse-ai-studio MCP server ready (workspace: ${workDir})`);
