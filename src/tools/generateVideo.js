import path from "node:path";
import { videoProviders, VIDEO_ASPECTS } from "../providers/video.js";
import { ensureDir, resolveInside, probe } from "../util.js";

export default {
  name: "generate_video",
  description:
    "Generate a short video clip from a text description (optionally animating an image URL). Saves an mp4 in the workspace and returns its path and duration.",
  input_schema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "What happens in the video" },
      aspect: { type: "string", enum: VIDEO_ASPECTS, description: "16:9, 9:16 or 1:1 (default 16:9)" },
      seconds: { type: "integer", description: "Length in seconds, 1-10 (default 5)" },
      image_url: { type: "string", description: "Optional image to animate (https URL)" },
      filename: { type: "string", description: "Output name without extension" },
    },
    required: ["prompt"],
  },
  async handler({ prompt, aspect = "16:9", seconds = 5, image_url, filename }, ctx) {
    if (seconds < 1 || seconds > 10) throw new Error("seconds must be between 1 and 10");
    const name = (filename || `video-${Date.now()}`).replace(/[^\w.-]/g, "_");
    const dir = resolveInside(ctx, "videos");
    await ensureDir(dir);
    const providerName = process.env.MUSE_VIDEO_PROVIDER || "mock";
    const provider = videoProviders[providerName];
    if (!provider) throw new Error(`Unknown video provider: ${providerName}`);
    const out = await provider.generate({
      prompt, aspect, seconds, imageUrl: image_url, outBase: path.join(dir, name),
    });
    const info = await probe(out.file);
    return {
      path: path.relative(resolveInside(ctx, "."), out.file),
      provider: out.provider,
      duration: info.duration,
      width: info.width,
      height: info.height,
    };
  },
};
