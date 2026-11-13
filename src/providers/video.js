import { writeFile } from "node:fs/promises";
import { run } from "../util.js";
import { replicateRun, download } from "./replicate.js";

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

/**
 * Replicate adapter. Set MUSE_VIDEO_MODEL to "owner/name" of the video model you want.
 * Input field names differ per model, so we send the common ones (prompt, duration, aspect_ratio, image).
 */
const replicate = {
  async generate({ prompt, aspect, seconds, outBase, imageUrl }) {
    const input = { prompt, duration: seconds, aspect_ratio: aspect };
    if (imageUrl) input.image = imageUrl;
    const url = await replicateRun({ model: process.env.MUSE_VIDEO_MODEL, input });
    const file = `${outBase}.mp4`;
    await writeFile(file, await download(url));
    return { file, provider: "replicate" };
  },
};

export const videoProviders = { mock, replicate };
export const VIDEO_ASPECTS = Object.keys(ASPECTS);
