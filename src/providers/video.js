import { writeFile } from "node:fs/promises";
import { run } from "../util.js";

const ASPECTS = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [720, 720] };

/** Offline placeholder: a colour-gradient test clip rendered by ffmpeg. */
const mock = {
  async generate({ aspect, seconds, outBase }) {
    const [w, h] = ASPECTS[aspect];
    const file = `${outBase}.mp4`;
    await run("ffmpeg", [
      "-y", "-f", "lavfi", "-i", `gradients=s=${w}x${h}:d=${seconds}:r=24:speed=0.02`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", file,
    ]);
    return { file, provider: "mock" };
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Replicate adapter. Set MUSE_VIDEO_MODEL to "owner/name" of the video model you want.
 * Input field names differ per model, so we send the common ones (prompt, duration, aspect_ratio).
 */
const replicate = {
  async generate({ prompt, aspect, seconds, outBase, imageUrl }) {
    const token = process.env.REPLICATE_API_TOKEN;
    const model = process.env.MUSE_VIDEO_MODEL;
    if (!token) throw new Error("REPLICATE_API_TOKEN is not set");
    if (!model) throw new Error("MUSE_VIDEO_MODEL is not set (use owner/name)");
    const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
    const input = { prompt, duration: seconds, aspect_ratio: aspect };
    if (imageUrl) input.image = imageUrl;
    let res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: "POST", headers, body: JSON.stringify({ input }),
    });
    let pred = await res.json();
    if (!res.ok) throw new Error(`Replicate error ${res.status}: ${pred?.detail || "unknown"}`);
    const deadline = Date.now() + 15 * 60 * 1000;
    while (!["succeeded", "failed", "canceled"].includes(pred.status)) {
      if (Date.now() > deadline) throw new Error("Video generation timed out");
      await sleep(4000);
      res = await fetch(pred.urls.get, { headers });
      pred = await res.json();
    }
    if (pred.status !== "succeeded") throw new Error(`Video generation ${pred.status}: ${pred.error || ""}`);
    const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    if (!url) throw new Error("Replicate returned no video output");
    const file = `${outBase}.mp4`;
    await writeFile(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
    return { file, provider: "replicate" };
  },
};

export const videoProviders = { mock, replicate };
export const VIDEO_ASPECTS = Object.keys(ASPECTS);
