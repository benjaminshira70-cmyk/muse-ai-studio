import path from "node:path";
import { rename, rm } from "node:fs/promises";
import { ensureDir, probe, resolveInside, run } from "../util.js";

const ASPECT_DIMS = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [720, 720] };
const VENC = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast"];
const AENC = ["-c:a", "aac"];

function num(v, name, min, max) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`"${name}" must be a number between ${min} and ${max}`);
  }
  return v;
}

function atempoChain(f) {
  const parts = [];
  while (f > 2) { parts.push("atempo=2"); f /= 2; }
  while (f < 0.5) { parts.push("atempo=0.5"); f /= 0.5; }
  parts.push(`atempo=${f.toFixed(4)}`);
  return parts.join(",");
}

/** Each operation returns ffmpeg args that turn `cur` into `out`. */
const OPS = {
  async trim(op, cur, out, ctx, info) {
    const start = op.start === undefined ? 0 : num(op.start, "start", 0, 86400);
    const args = ["-y", "-i", cur, "-ss", String(start)];
    if (op.end !== undefined) {
      const end = num(op.end, "end", 0, 86400);
      if (end <= start) throw new Error("trim: end must be greater than start");
      args.push("-to", String(end));
    }
    return [...args, ...VENC, ...(info.hasAudio ? AENC : ["-an"]), out];
  },

  async reframe(op, cur, out, ctx, info) {
    const dims = ASPECT_DIMS[op.aspect];
    if (!dims) throw new Error(`reframe: aspect must be one of ${Object.keys(ASPECT_DIMS).join(", ")}`);
    const [w, h] = dims;
    return [
      "-y", "-i", cur,
      "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`,
      ...VENC, ...(info.hasAudio ? ["-c:a", "copy"] : ["-an"]), out,
    ];
  },

  async speed(op, cur, out, ctx, info) {
    const f = num(op.factor, "factor", 0.25, 4);
    const args = ["-y", "-i", cur, "-vf", `setpts=PTS/${f}`];
    if (info.hasAudio) args.push("-af", atempoChain(f));
    return [...args, ...VENC, ...(info.hasAudio ? AENC : ["-an"]), out];
  },

  async fade(op, cur, out, ctx, info) {
    const din = op.in === undefined ? 0 : num(op.in, "in", 0, 30);
    const dout = op.out === undefined ? 0 : num(op.out, "out", 0, 30);
    if (!din && !dout) throw new Error("fade: set \"in\" and/or \"out\" seconds");
    const v = [], a = [];
    if (din) { v.push(`fade=t=in:st=0:d=${din}`); a.push(`afade=t=in:st=0:d=${din}`); }
    if (dout) {
      const st = Math.max(0, info.duration - dout);
      v.push(`fade=t=out:st=${st}:d=${dout}`); a.push(`afade=t=out:st=${st}:d=${dout}`);
    }
    const args = ["-y", "-i", cur, "-vf", v.join(",")];
    if (info.hasAudio) args.push("-af", a.join(","));
    return [...args, ...VENC, ...(info.hasAudio ? AENC : ["-an"]), out];
  },

  async mute(op, cur, out) {
    return ["-y", "-i", cur, "-an", "-c:v", "copy", out];
  },

  async add_audio(op, cur, out, ctx, info) {
    if (!op.file) throw new Error("add_audio: \"file\" is required");
    const audio = resolveInside(ctx, op.file);
    const vol = op.volume === undefined ? 1 : num(op.volume, "volume", 0, 4);
    if (info.hasAudio) {
      return [
        "-y", "-i", cur, "-i", audio,
        "-filter_complex", `[1:a]volume=${vol}[b];[0:a][b]amix=inputs=2:duration=first:normalize=0[a]`,
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", ...AENC, out,
      ];
    }
    return [
      "-y", "-i", cur, "-i", audio,
      "-filter_complex", `[1:a]volume=${vol}[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", ...AENC, "-shortest", out,
    ];
  },

  async append(op, cur, out, ctx, info) {
    if (!op.file) throw new Error("append: \"file\" is required");
    const other = resolveInside(ctx, op.file);
    const oi = await probe(other);
    const w = info.width, h = info.height;
    const norm = (i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`;
    const keepAudio = info.hasAudio && oi.hasAudio;
    const graph = keepAudio
      ? `${norm(0)};${norm(1)};[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]`
      : `${norm(0)};${norm(1)};[v0][v1]concat=n=2:v=1:a=0[v]`;
    ctx.notes?.push(...(keepAudio ? [] : ["append: audio dropped because one clip had no audio"]));
    return [
      "-y", "-i", cur, "-i", other, "-filter_complex", graph,
      "-map", "[v]", ...(keepAudio ? ["-map", "[a]"] : []), ...VENC, ...(keepAudio ? AENC : []), out,
    ];
  },
};

export default {
  name: "edit_video",
  description:
    "Edit a video in the workspace by applying operations in order, then save the result. Operations: trim {start,end}, reframe {aspect: 16:9|9:16|1:1}, speed {factor 0.25-4}, fade {in,out seconds}, mute {}, add_audio {file, volume}, append {file}. Returns the output path and new duration.",
  input_schema: {
    type: "object",
    properties: {
      input: { type: "string", description: "Path of the source video inside the workspace" },
      operations: {
        type: "array",
        description: "List of { op: 'trim' | 'reframe' | 'speed' | 'fade' | 'mute' | 'add_audio' | 'append', ...params }",
      },
      output: { type: "string", description: "Output file name, e.g. final.mp4" },
    },
    required: ["input", "operations", "output"],
  },
  async handler({ input, operations, output }, ctx) {
    if (!operations.length) throw new Error("operations must not be empty");
    if (operations.length > 12) throw new Error("At most 12 operations per call");
    const src = resolveInside(ctx, input);
    const outName = output.endsWith(".mp4") ? output : `${output}.mp4`;
    const finalPath = resolveInside(ctx, path.join("videos", path.basename(outName)));
    const tmpDir = resolveInside(ctx, ".tmp");
    await ensureDir(tmpDir);
    await ensureDir(path.dirname(finalPath));

    const notes = [];
    const opCtx = { ...ctx, notes };
    // resolveInside needs the same workspace the caller used
    opCtx.workDir = ctx.workDir;
    let cur = src;
    const temps = [];
    try {
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const fn = OPS[op?.op];
        if (!fn) throw new Error(`Unknown operation "${op?.op}" (step ${i + 1})`);
        const info = await probe(cur);
        const out = path.join(tmpDir, `step-${Date.now()}-${i}.mp4`);
        temps.push(out);
        const args = await fn(op, cur, out, opCtx, info);
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
        cur = out;
      }
      await rename(cur, finalPath);
    } finally {
      await Promise.all(temps.map((t) => rm(t, { force: true })));
    }
    const info = await probe(finalPath);
    return {
      path: path.relative(resolveInside(ctx, "."), finalPath),
      duration: info.duration,
      width: info.width,
      height: info.height,
      hasAudio: info.hasAudio,
      notes,
    };
  },
};
