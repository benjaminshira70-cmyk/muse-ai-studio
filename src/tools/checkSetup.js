import { existsSync } from "node:fs";
import { run, workspaceDir } from "../util.js";
import { imageProviders } from "../providers/image.js";
import { videoProviders } from "../providers/video.js";
import { findFont } from "./fonts.js";

async function ffmpegInfo() {
  try {
    const v = await run("ffmpeg", ["-hide_banner", "-version"]);
    const f = await run("ffmpeg", ["-hide_banner", "-filters"]);
    return {
      available: true,
      version: v.stdout.split("\n")[0],
      drawtext: /\sdrawtext\s/.test(f.stdout),
    };
  } catch {
    return { available: false, drawtext: false };
  }
}

const NEEDS = {
  image: { mock: [], openai: ["OPENAI_API_KEY"], replicate: ["REPLICATE_API_TOKEN", "MUSE_IMAGE_MODEL"] },
  video: { mock: [], replicate: ["REPLICATE_API_TOKEN", "MUSE_VIDEO_MODEL"] },
};

function providerStatus(kind, registry) {
  const name = process.env[kind === "image" ? "MUSE_IMAGE_PROVIDER" : "MUSE_VIDEO_PROVIDER"] || "mock";
  if (!registry[name]) return { provider: name, ready: false, problem: `Unknown provider "${name}"`, options: Object.keys(registry) };
  const missing = (NEEDS[kind][name] || []).filter((k) => !process.env[k]);
  return {
    provider: name,
    ready: missing.length === 0,
    real: name !== "mock",
    missing,
    options: Object.keys(registry),
  };
}

export default {
  name: "check_setup",
  description:
    "Diagnose this server: is ffmpeg installed, can it draw text on video, which image/video providers are configured, and which API keys are missing. Never reveals secret values. Call this first if a tool fails.",
  input_schema: { type: "object", properties: {} },
  async handler(_input, ctx) {
    const ff = await ffmpegInfo();
    const font = findFont();
    const warnings = [];
    if (!ff.available) warnings.push("ffmpeg is not installed: video tools will fail.");
    if (ff.available && !ff.drawtext) warnings.push("ffmpeg has no drawtext filter: text/subtitle overlays will fail.");
    if (ff.drawtext && !font) warnings.push("No font file found: set MUSE_FONT to a .ttf/.otf path for text overlays.");
    const image = providerStatus("image", imageProviders);
    const video = providerStatus("video", videoProviders);
    if (!image.real) warnings.push("Image generation is using the offline mock (placeholder images).");
    if (!video.real) warnings.push("Video generation is using the offline mock (test clips).");
    return {
      node: process.version,
      workspace: workspaceDir(ctx),
      workspaceExists: existsSync(workspaceDir(ctx)),
      ffmpeg: ff,
      font: font || null,
      image,
      video,
      warnings,
    };
  },
};
