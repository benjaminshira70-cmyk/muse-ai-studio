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
  assert.deepEqual(names, ["build_website", "check_setup", "edit_video", "generate_image", "generate_video", "video_info"]);
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

const frameHash = async (file) =>
  (await run("ffmpeg", ["-v", "error", "-i", file, "-frames:v", "1", "-f", "md5", "-"])).stdout.trim();

test("video: text overlay and subtitles change the picture and keep length", async () => {
  const ctx = await mk();
  const gen = await callTool("generate_video", { prompt: "bg", seconds: 4, filename: "bg" }, ctx);
  const src = path.join(ctx.workDir, gen.path);
  const titled = await callTool("edit_video", {
    input: gen.path, output: "titled",
    operations: [{ op: "text", text: "Fox Meadow Studio, a very long title that must wrap onto several lines nicely", position: "center", color: "#ffcc00" }],
  }, ctx);
  assert.notEqual(await frameHash(path.join(ctx.workDir, titled.path)), await frameHash(src));
  assert.ok(Math.abs(titled.duration - 4) < 0.3);

  const subbed = await callTool("edit_video", {
    input: gen.path, output: "subbed",
    operations: [{ op: "subtitles", cues: [{ start: 0, end: 1.5, text: "First line" }, { start: 2, end: 3.5, text: "It's \"quoted\": 100%" }] }],
  }, ctx);
  assert.notEqual(await frameHash(path.join(ctx.workDir, subbed.path)), await frameHash(src));
  assert.equal(subbed.width, 1280);
});

test("video: SRT file subtitles are parsed", async () => {
  const ctx = await mk();
  const gen = await callTool("generate_video", { prompt: "bg", seconds: 3 }, ctx);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(ctx.workDir, "cap.srt"), "1\n00:00:00,000 --> 00:00:01,500\nHello there\n\n2\n00:00:01,600 --> 00:00:02,900\nSecond cue\n");
  const r = await callTool("edit_video", { input: gen.path, output: "srt", operations: [{ op: "subtitles", file: "cap.srt" }] }, ctx);
  assert.ok(r.duration > 2.5);
});

test("video: music loops under a clip, with fades, ducking and delay", async () => {
  const ctx = await mk();
  const gen = await callTool("generate_video", { prompt: "bg", seconds: 5 }, ctx);
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", path.join(ctx.workDir, "short.wav")]);
  const r = await callTool("edit_video", {
    input: gen.path, output: "scored",
    operations: [{ op: "add_audio", file: "short.wav", loop: true, volume: 0.4, fade_in: 0.5, fade_out: 1, start: 0.5 }],
  }, ctx);
  assert.equal(r.hasAudio, true);
  assert.ok(Math.abs(r.duration - 5) < 0.3, `duration ${r.duration}`);
  // now duck a second track under the first
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=5", path.join(ctx.workDir, "bed.wav")]);
  const d = await callTool("edit_video", {
    input: r.path, output: "ducked", operations: [{ op: "add_audio", file: "bed.wav", duck: true, volume: 0.6 }],
  }, ctx);
  assert.equal(d.hasAudio, true);
});

test("check_setup reports ffmpeg and never leaks secrets", async () => {
  const ctx = await mk();
  process.env.OPENAI_API_KEY = "sk-secret-value";
  try {
    const r = await callTool("check_setup", {}, ctx);
    assert.equal(r.ffmpeg.available, true);
    assert.ok(!JSON.stringify(r).includes("sk-secret-value"));
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test("website: every theme and every section type renders", async () => {
  const ctx = await mk();
  await callTool("generate_image", { prompt: "a", filename: "a" }, ctx);
  await callTool("generate_video", { prompt: "v", seconds: 1, filename: "clip" }, ctx);
  const sections = [
    { type: "hero", nav: "Home", headline: "H", subheadline: "S", image: "images/a.svg", align: "center", background: "gradient", cta: { label: "Go", url: "#x" } },
    { type: "logos", title: "Trusted by", items: ["Acme", "Globex <b>"] },
    { type: "stats", items: [{ value: "10k", label: "Users" }, { value: "99%", label: "Uptime" }] },
    { type: "features", title: "F", items: [{ icon: "⚡", title: "t", text: "x" }] },
    { type: "steps", title: "How", items: [{ title: "One", text: "a" }, { title: "Two", text: "b" }] },
    { type: "video", title: "Watch", src: "videos/clip.mp4", poster: "images/a.svg" },
    { type: "gallery", title: "G", images: [{ src: "images/a.svg", alt: "a" }] },
    { type: "team", title: "Team", items: [{ name: "Sam", role: "CEO", bio: "Hi", image: "images/a.svg" }] },
    { type: "testimonials", items: [{ quote: "q", name: "n" }] },
    { type: "pricing", plans: [{ name: "P", price: "$1", features: ["f"] }] },
    { type: "faq", items: [{ q: "q", a: "a" }] },
    { type: "contact", title: "Hi", text: "Write", email: "me@example.com" },
    { type: "cta", headline: "C", text: "t", button: { label: "b", url: "#" } },
    { type: "text", title: "T", body: "b" },
  ];
  for (const theme of ["modern", "minimal", "bold", "elegant", "playful"]) {
    const r = await callTool("build_website", { site_name: `t-${theme}`, title: "T", theme, favicon: "🦊", lang: "hi", footer_links: [{ label: "Home", url: "/" }, { label: "bad", url: "javascript:x" }], sections }, ctx);
    const html = await readFile(path.join(ctx.workDir, r.path), "utf8");
    for (const cls of ["stats", "steps", "logos", "video", "person", "contact"]) assert.ok(html.includes(`class="${cls}`) || html.includes(`${cls}"`), `${theme}: missing ${cls}`);
    assert.ok(html.includes('lang="hi"') && html.includes("mailto:me@example.com") && html.includes("<video controls"));
    assert.ok(!html.includes("javascript:"), "javascript: link leaked");
    assert.ok(html.includes("Globex &lt;b&gt;") && !html.includes("Globex <b>"), "logo text must be escaped");
    assert.ok(r.assets.includes("a.svg") && r.assets.includes("clip.mp4"));
  }
});

test("website: only images/videos are copied, bad email rejected, name clashes handled", async () => {
  const ctx = await mk();
  const { writeFile, mkdir } = await import("node:fs/promises");
  await writeFile(path.join(ctx.workDir, "secret.env"), "KEY=1");
  const leak = await callToolSafe("build_website", { site_name: "x", title: "x", sections: [{ type: "hero", headline: "h", subheadline: "s", image: "secret.env" }] }, ctx);
  assert.equal(leak.ok, false);
  assert.match(leak.error, /not allowed/);
  const mail = await callToolSafe("build_website", { site_name: "x", title: "x", sections: [{ type: "contact", email: "nope", text: "t" }] }, ctx);
  assert.equal(mail.ok, false);

  await mkdir(path.join(ctx.workDir, "d1"));
  await mkdir(path.join(ctx.workDir, "d2"));
  await writeFile(path.join(ctx.workDir, "d1/pic.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  await writeFile(path.join(ctx.workDir, "d2/pic.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  const r = await callTool("build_website", { site_name: "clash", title: "x", sections: [{ type: "gallery", images: [{ src: "d1/pic.svg", alt: "1" }, { src: "d2/pic.svg", alt: "2" }] }] }, ctx);
  assert.deepEqual(r.assets.sort(), ["pic-2.svg", "pic.svg"]);
});
