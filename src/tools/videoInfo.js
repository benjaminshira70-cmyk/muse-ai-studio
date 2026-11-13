import { probe, resolveInside } from "../util.js";

export default {
  name: "video_info",
  description: "Get duration, resolution and audio presence of a video in the workspace.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string", description: "Video path inside the workspace" } },
    required: ["path"],
  },
  async handler({ path: p }, ctx) {
    return probe(resolveInside(ctx, p));
  },
};
