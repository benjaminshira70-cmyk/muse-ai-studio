import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { listTools, callTool, callToolSafe } from "../src/index.js";
import { run } from "../src/util.js";

const mk = async () => ({ workDir: await mkdtemp(path.join(tmpdir(), "muse-")) });

test("registry exposes all tools in both formats", () => {
  const names = listTools().map((t) => t.name).sort();
  assert.deepEqual(names, ["build_website", "edit_video", "generate_image", "generate_video", "video_info"]);
  assert.equal(listTools("openai")[0].type, "function");
});

test("bad input and unknown tools are reported, not thrown, by callToolSafe", async () => {
  const ctx = await mk();
  assert.equal((await callToolSafe("generate_image", {}, ctx)).ok, false);
  assert.equal((await callToolSafe("nope", {}, ctx)).ok, false);
  assert.equal((await callToolSafe("generate_image", { prompt: "x", shape: "huge" }, ctx)).ok, false);
});

test("paths cannot escape the workspace", async () => {
  const ctx = await mk();
  const r = await callToolSafe("video_info", { path: "../../etc/passwd" }, ctx);
  assert.equal(r.ok, false);
  assert.match(r.error, /escapes the workspace/);
});

test("generate_image (mock) writes a file", async () => {
  const ctx = await mk();
  const r = await callTool("generate_image", { prompt: "a red fox <b>", filename: "fox" }, ctx);
  assert.equal(r.path, path.join("images", "fox.svg"));
  const svg = await readFile(path.join(ctx.workDir, r.path), "utf8");
  assert.ok(svg.includes("&lt;b&gt;"), "prompt must be escaped in the svg");
});

test("build_website renders sections, escapes text, blocks javascript: links", async () => {
  const ctx = await mk();
  await callTool("generate_image", { prompt: "hero", filename: "hero" }, ctx);
  const r = await callTool("build_website", {
    site_name: "demo", title: "Demo <script>alert(1)</script>", accent: "#0ea5e9",
    sections: [
      { type: "hero", nav: "Home", headline: "Hello", subheadline: "World", image: "images/hero.svg", cta: { label: "Go", url: "javascript:alert(1)" } },
      { type: "features", nav: "Features", title: "Why", items: [{ icon: "⚡", title: "Fast", text: "<img onerror=x>" }] },
      { type: "pricing", title: "Plans", plans: [{ name: "Pro", price: "$9", features: ["A"], highlight: true, cta: { label: "Buy", url: "https://example.com" } }] },
      { type: "faq", title: "FAQ", items: [{ q: "Q?", a: "A." }] },
      { type: "testimonials", items: [{ quote: "Great", name: "Sam", role: "CEO" }] },
      { type: "cta", headline: "Join", text: "Now", button: { label: "Start", url: "#" } },
    ],
  }, ctx);
  const html = await readFile(path.join(ctx.workDir, r.path), "utf8");
  assert.ok(!html.includes("<script>alert"), "title must be escaped");
  assert.ok(!html.includes("javascript:"), "javascript: URL must be neutralised");
  assert.ok(!html.includes("<img onerror"), "feature text must be escaped");
  assert.ok(html.includes('href="https://example.com"'));
  await access(path.join(ctx.workDir, "sites/demo/assets/hero.svg"));
  assert.equal(r.sections, 6);
});

test("build_website rejects unknown section types", async () => {
  const ctx = await mk();
  const r = await callToolSafe("build_website", { site_name: "x", title: "x", sections: [{ type: "bogus" }] }, ctx);
  assert.equal(r.ok, false);
});

test("video: generate, then trim, reframe, speed, fade, mute in one call", async () => {
  const ctx = await mk();
  const gen = await callTool("generate_video", { prompt: "waves", seconds: 4, filename: "src" }, ctx);
  assert.ok(gen.duration >= 3.9 && gen.duration <= 4.2);
  const out = await callTool("edit_video", {
    input: gen.path, output: "edited",
    operations: [
      { op: "trim", start: 1, end: 3 },
      { op: "reframe", aspect: "9:16" },
      { op: "speed", factor: 2 },
      { op: "fade", in: 0.2, out: 0.2 },
      { op: "mute" },
    ],
  }, ctx);
  assert.equal(out.width, 720);
  assert.equal(out.height, 1280);
  assert.ok(out.duration > 0.8 && out.duration < 1.3, `duration ${out.duration}`);
  assert.equal(out.hasAudio, false);
});

test("video: add_audio and append", async () => {
  const ctx = await mk();
  const a = await callTool("generate_video", { prompt: "a", seconds: 2, filename: "a" }, ctx);
  const b = await callTool("generate_video", { prompt: "b", seconds: 2, aspect: "1:1", filename: "b" }, ctx);
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", path.join(ctx.workDir, "tone.wav")]);
  const withAudio = await callTool("edit_video", {
    input: a.path, output: "a_audio", operations: [{ op: "add_audio", file: "tone.wav", volume: 0.5 }],
  }, ctx);
  assert.equal(withAudio.hasAudio, true);
  const joined = await callTool("edit_video", {
    input: a.path, output: "joined", operations: [{ op: "append", file: b.path }],
  }, ctx);
  assert.ok(joined.duration > 3.8 && joined.duration < 4.4, `duration ${joined.duration}`);
  assert.equal(joined.width, 1280);
});

test("edit_video validates operations", async () => {
  const ctx = await mk();
  const gen = await callTool("generate_video", { prompt: "x", seconds: 2 }, ctx);
  for (const operations of [[{ op: "trim", start: 2, end: 1 }], [{ op: "speed", factor: 99 }], [{ op: "explode" }]]) {
    assert.equal((await callToolSafe("edit_video", { input: gen.path, output: "z", operations }, ctx)).ok, false);
  }
});
