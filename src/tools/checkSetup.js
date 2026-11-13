import { existsSync } from "node:fs";
import { run, workspaceDir } from "../util.js";
import { imageProviders } from "../providers/image.js";
import { videoProviders } from "../providers/video.js";
import { findFont } from "./fonts.js";
import { pickProvider } from "../providers/select.js";

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
  const requested = process.env[kind === "image" ? "MUSE_IMAGE_PROVIDER" : "MUSE_VIDEO_PROVIDER"] || "mock";
  let picked;
  try {
    picked = pickProvider(kind, registry);
  } catch (e) {
    return { provider: requested, ready: false, problem: e.message, options: ["auto", ...Object.keys(registry)] };
  }
  const missing = (NEEDS[kind][picked.name] || []).filter((k) => !process.env[k]);
  return {
    provider: picked.name,
    requested,
    ready: missing.length === 0,
    real: picked.name !== "mock",
    missing,
    options: ["auto", ...Object.keys(registry)],
    hint: requested !== "auto" && picked.name === "mock" ? 'Set MUSE_*_PROVIDER to "auto" to use real providers as soon as keys are present' : undefined,
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
    if (!image.real) warnings.push("Image generation is using the offline mock (placeholder images). Add OPENAI_API_KEY, or REPLICATE_API_TOKEN + MUSE_IMAGE_MODEL.");
    if (image.missing?.length) warnings.push(`Image provider ${image.provider} is missing: ${image.missing.join(", ")}`);
    if (video.missing?.length) warnings.push(`Video provider ${video.provider} is missing: ${video.missing.join(", ")}`);
    if (!video.real) warnings.push("Video generation is using the offline mock (test clips). Add REPLICATE_API_TOKEN + MUSE_VIDEO_MODEL.");
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
