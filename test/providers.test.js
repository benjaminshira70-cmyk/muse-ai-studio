import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { callTool, callToolSafe } from "../src/index.js";
import { snapDuration } from "../src/providers/select.js";
import { run } from "../src/util.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const seen = {};
let server, base, mp4;
let polls = 0;

const KEYS = ["MUSE_IMAGE_PROVIDER", "MUSE_VIDEO_PROVIDER", "OPENAI_API_KEY", "OPENAI_API_BASE", "REPLICATE_API_TOKEN", "REPLICATE_API_BASE",
  "REPLICATE_POLL_MS", "MUSE_IMAGE_MODEL", "MUSE_VIDEO_MODEL", "MUSE_VIDEO_DURATIONS", "MUSE_VIDEO_EXTRA_INPUT", "MUSE_IMAGE_EXTRA_INPUT"];
const saved = {};
const reset = () => KEYS.forEach((k) => delete process.env[k]);
const mk = async () => ({ workDir: await mkdtemp(path.join(tmpdir(), "muse-p-")) });

before(async () => {
  KEYS.forEach((k) => (saved[k] = process.env[k]));
  const dir = await mkdtemp(path.join(tmpdir(), "muse-fake-"));
  mp4 = path.join(dir, "out.mp4");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:d=2:r=24", "-pix_fmt", "yuv420p", mp4]);
  mp4 = await readFile(mp4);

  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (req.method === "POST" && req.url === "/v1/images/generations") {
        seen.openai = { auth: req.headers.authorization, body: JSON.parse(body) };
        return json(200, { data: [{ b64_json: PNG }] });
      }
      if (req.method === "POST" && req.url === "/v1/models/acme/vid/predictions") {
        seen.video = { auth: req.headers.authorization, body: JSON.parse(body) };
        polls = 0;
        return json(201, { status: "starting", urls: { get: `${base}/pred/1` } });
      }
      if (req.method === "POST" && req.url === "/v1/models/acme/img/predictions") {
        seen.img = JSON.parse(body);
        return json(201, { status: "succeeded", output: [`${base}/pic.png`], urls: { get: `${base}/pred/2` } });
      }
      if (req.method === "POST" && req.url === "/v1/models/acme/bad/predictions") return json(422, { detail: "duration must be one of 4, 6, 8" });
      if (req.method === "POST" && req.url === "/v1/models/acme/fail/predictions") return json(201, { status: "failed", error: "NSFW flagged", urls: { get: `${base}/x` } });
      if (req.url === "/pred/1") {
        polls++;
        return json(200, polls < 2 ? { status: "processing", urls: { get: `${base}/pred/1` } } : { status: "succeeded", output: `${base}/out.mp4`, urls: { get: `${base}/pred/1` } });
      }
      if (req.url === "/out.mp4") { res.writeHead(200, { "content-type": "video/mp4" }); return res.end(mp4); }
      if (req.url === "/pic.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(Buffer.from(PNG, "base64")); }
      json(404, { detail: "not found" });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
});

test("snapDuration picks the nearest allowed length", () => {
  assert.equal(snapDuration(5, "4,8"), 4);
  assert.equal(snapDuration(7, "4,8"), 8);
  assert.equal(snapDuration(10, "4,6,8"), 8);
  assert.equal(snapDuration(5, undefined), 5);
  assert.equal(snapDuration(5, "junk"), 5);
});

test("auto mode picks real providers only when keys exist", async () => {
  reset();
  const ctx = await mk();
  process.env.MUSE_IMAGE_PROVIDER = "auto";
  process.env.MUSE_VIDEO_PROVIDER = "auto";
  assert.equal((await callTool("generate_image", { prompt: "x" }, ctx)).provider, "mock");
  assert.equal((await callTool("generate_video", { prompt: "x", seconds: 1 }, ctx)).provider, "mock");
  process.env.REPLICATE_API_TOKEN = "r8_test";
  process.env.MUSE_VIDEO_MODEL = "acme/vid"; // token but no image model -> image still mock
  assert.equal((await callTool("check_setup", {}, ctx)).image.provider, "mock");
  assert.equal((await callTool("check_setup", {}, ctx)).video.provider, "replicate");
  process.env.OPENAI_API_KEY = "sk-test";
  assert.equal((await callTool("check_setup", {}, ctx)).image.provider, "openai");
});

test("openai adapter sends the right request and saves the png", async () => {
  reset();
  const ctx = await mk();
  Object.assign(process.env, { MUSE_IMAGE_PROVIDER: "openai", OPENAI_API_KEY: "sk-test", OPENAI_API_BASE: base });
  const r = await callTool("generate_image", { prompt: "a red fox", shape: "landscape", filename: "fox" }, ctx);
  assert.equal(r.provider, "openai");
  assert.equal(seen.openai.auth, "Bearer sk-test");
  assert.equal(seen.openai.body.prompt, "a red fox");
  assert.equal(seen.openai.body.size, "1536x1024");
  assert.equal(seen.openai.body.model, "gpt-image-1");
  assert.equal((await readFile(path.join(ctx.workDir, r.path))).subarray(1, 4).toString(), "PNG");
});

test("replicate video: polls, snaps duration, merges extra inputs, downloads the clip", async () => {
  reset();
  const ctx = await mk();
  Object.assign(process.env, {
    MUSE_VIDEO_PROVIDER: "replicate", REPLICATE_API_TOKEN: "r8_test", REPLICATE_API_BASE: base, REPLICATE_POLL_MS: "20",
    MUSE_VIDEO_MODEL: "acme/vid", MUSE_VIDEO_DURATIONS: "4,6,8", MUSE_VIDEO_EXTRA_INPUT: '{"resolution":"720p","generate_audio":false}',
  });
  const r = await callTool("generate_video", { prompt: "waves", seconds: 5, aspect: "9:16", image_url: "https://example.com/a.png" }, ctx);
  assert.equal(r.provider, "replicate");
  assert.equal(seen.video.auth, "Bearer r8_test");
  assert.deepEqual(seen.video.body.input, {
    prompt: "waves", duration: 4, aspect_ratio: "9:16", resolution: "720p", generate_audio: false, image: "https://example.com/a.png",
  });
  assert.ok(r.duration > 1.5 && r.width === 320);
  assert.ok(polls >= 2, "should have polled until succeeded");
});

test("replicate image works and keeps the file extension", async () => {
  reset();
  const ctx = await mk();
  Object.assign(process.env, { MUSE_IMAGE_PROVIDER: "replicate", REPLICATE_API_TOKEN: "r8_test", REPLICATE_API_BASE: base, MUSE_IMAGE_MODEL: "acme/img", MUSE_IMAGE_EXTRA_INPUT: '{"num_outputs":1}' });
  const r = await callTool("generate_image", { prompt: "logo", shape: "portrait", filename: "logo" }, ctx);
  assert.ok(r.path.endsWith("logo.png"));
  assert.deepEqual(seen.img.input, { prompt: "logo", aspect_ratio: "2:3", num_outputs: 1 });
});

test("provider errors are surfaced clearly", async () => {
  reset();
  const ctx = await mk();
  Object.assign(process.env, { MUSE_VIDEO_PROVIDER: "replicate", REPLICATE_API_TOKEN: "r8_test", REPLICATE_API_BASE: base });
  process.env.MUSE_VIDEO_MODEL = "acme/bad";
  let r = await callToolSafe("generate_video", { prompt: "x" }, ctx);
  assert.match(r.error, /422.*duration must be one of/);
  process.env.MUSE_VIDEO_MODEL = "acme/fail";
  r = await callToolSafe("generate_video", { prompt: "x" }, ctx);
  assert.match(r.error, /failed.*NSFW/);
  delete process.env.MUSE_VIDEO_MODEL;
  r = await callToolSafe("generate_video", { prompt: "x" }, ctx);
  assert.match(r.error, /MUSE_VIDEO_MODEL/);
  process.env.MUSE_VIDEO_EXTRA_INPUT = "not json";
  process.env.MUSE_VIDEO_MODEL = "acme/vid";
  r = await callToolSafe("generate_video", { prompt: "x" }, ctx);
  assert.match(r.error, /must be valid JSON/);
});

test("check_setup lists exactly what is missing and never leaks keys", async () => {
  reset();
  const ctx = await mk();
  Object.assign(process.env, { MUSE_IMAGE_PROVIDER: "replicate", MUSE_VIDEO_PROVIDER: "replicate", REPLICATE_API_TOKEN: "r8_supersecret" });
  const r = await callTool("check_setup", {}, ctx);
  assert.deepEqual(r.image.missing, ["MUSE_IMAGE_MODEL"]);
  assert.deepEqual(r.video.missing, ["MUSE_VIDEO_MODEL"]);
  assert.ok(r.warnings.some((w) => w.includes("MUSE_VIDEO_MODEL")));
  assert.ok(!JSON.stringify(r).includes("r8_supersecret"));
});
