import path from "node:path";
import { imageProviders, IMAGE_SHAPES } from "../providers/image.js";
import { ensureDir, resolveInside } from "../util.js";

export default {
  name: "generate_image",
  description:
    "Generate an image from a text description. Saves it in the workspace and returns the file path. Use it for hero images, product shots, thumbnails, logos and illustrations.",
  input_schema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Detailed description of the image" },
      shape: { type: "string", enum: IMAGE_SHAPES, description: "square, landscape or portrait (default square)" },
      filename: { type: "string", description: "Output name without extension, e.g. hero" },
    },
    required: ["prompt"],
  },
  async handler({ prompt, shape = "square", filename }, ctx) {
    const name = (filename || `image-${Date.now()}`).replace(/[^\w.-]/g, "_");
    const dir = resolveInside(ctx, "images");
    await ensureDir(dir);
    const providerName = process.env.MUSE_IMAGE_PROVIDER || "mock";
    const provider = imageProviders[providerName];
    if (!provider) throw new Error(`Unknown image provider: ${providerName}`);
    const out = await provider.generate({ prompt, shape, outBase: path.join(dir, name) });
    return { path: path.relative(resolveInside(ctx, "."), out.file), provider: out.provider, shape };
  },
};
