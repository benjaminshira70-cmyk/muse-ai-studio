#!/usr/bin/env node
import { listTools, callToolSafe } from "./index.js";

const [cmd, name, json] = process.argv.slice(2);

if (cmd === "list") {
  const format = name === "openai" ? "openai" : "anthropic";
  console.log(JSON.stringify(listTools(format), null, 2));
} else if (cmd === "call" && name) {
  const res = await callToolSafe(name, json ? JSON.parse(json) : {});
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
} else {
  console.log("Usage:\n  muse-tools list [anthropic|openai]\n  muse-tools call <tool> '<json input>'");
}
