import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";

test("MCP server: initialize, list tools, call a tool, handle errors", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "muse-mcp-"));
  const child = spawn("node", ["src/server.js"], {
    env: { ...process.env, MUSE_WORKSPACE: dir, MUSE_IMAGE_PROVIDER: "mock" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pending = new Map();
  readline.createInterface({ input: child.stdout }).on("line", (l) => {
    const m = JSON.parse(l);
    pending.get(m.id)?.(m);
  });
  let n = 0;
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = ++n;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });

  try {
    const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(init.result.serverInfo.name, "muse-ai-studio");
    assert.equal(init.result.protocolVersion, "2025-03-26");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const list = await rpc("tools/list");
    assert.equal(list.result.tools.length, 6);
    assert.ok(list.result.tools.every((t) => t.inputSchema && t.description));

    const ok = await rpc("tools/call", { name: "generate_image", arguments: { prompt: "fox", filename: "fox" } });
    assert.equal(ok.result.isError, false);
    assert.match(ok.result.content[0].text, /images\/fox\.svg/);
    await access(path.join(dir, "images", "fox.svg"));

    const bad = await rpc("tools/call", { name: "generate_image", arguments: {} });
    assert.equal(bad.result.isError, true);

    const unknown = await rpc("nope");
    assert.equal(unknown.error.code, -32601);
  } finally {
    child.kill();
  }
});
