import path from "node:path";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { ensureDir, probe, resolveInside, run } from "../util.js";
import { findFont } from "./fonts.js";

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


/** Escape a value for use inside an ffmpeg filter option. */
const fq = (v) => String(v).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");

function wrapText(text, maxChars) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + word).length > maxChars) { out.push(line); line = word; }
      else line = line ? line + " " + word : word;
    }
    out.push(line);
  }
  return out.join("\n");
}

const POS_Y = { top: "h*0.08", center: "(h-text_h)/2", bottom: "h-text_h-h*0.08" };

function color(c, fallback) {
  if (c === undefined) return fallback;
  if (!/^(#[0-9a-fA-F]{6}|[a-z]{3,20})$/.test(c)) throw new Error(`Invalid colour "${c}" (use #rrggbb or a name like white)`);
  return c.startsWith("#") ? "0x" + c.slice(1) : c;
}

/** Build one drawtext filter. The text goes through a file so no escaping of user text is needed. */
async function drawtext({ text, start, end, position = "bottom", size = 0.05, textColor, boxColor, info, tmpDir, key }) {
  const font = findFont();
  if (!font) throw new Error("No font found for text overlays. Set MUSE_FONT to a .ttf/.otf file path.");
  if (!POS_Y[position]) throw new Error(`position must be one of: ${Object.keys(POS_Y).join(", ")}`);
  const px = Math.max(12, Math.round(info.height * num(size, "size", 0.02, 0.2)));
  const maxChars = Math.max(8, Math.floor((info.width * 0.88) / (px * 0.55)));
  const file = `txt-${key}.txt`;
  await writeFile(path.join(tmpDir, file), wrapText(text, maxChars));
  const parts = [
    `fontfile='${fq(font)}'`, `textfile='${fq(file)}'`, `fontsize=${px}`,
    `fontcolor=${color(textColor, "white")}`, "x=(w-text_w)/2", `y=${POS_Y[position]}`,
    "line_spacing=6", `box=1`, `boxcolor=${color(boxColor, "black")}@0.55`, `boxborderw=${Math.round(px * 0.4)}`,
  ];
  if (start !== undefined || end !== undefined) {
    const a = start === undefined ? 0 : num(start, "start", 0, 86400);
    const b = end === undefined ? 86400 : num(end, "end", 0, 86400);
    if (b <= a) throw new Error("text: end must be greater than start");
    parts.push(`enable='between(t,${a},${b})'`);
  }
  return `drawtext=${parts.join(":")}`;
}

function parseSrt(src) {
  const toSec = (t) => {
    const m = t.trim().match(/^(\d+):(\d+):(\d+)[,.](\d+)$/);
    if (!m) throw new Error(`Bad SRT timestamp: ${t}`);
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, "0").slice(0, 3) / 1000;
  };
  return src.replace(/\r/g, "").split(/\n\s*\n/).map((block) => {
    const lines = block.trim().split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) return null;
    const [a, b] = lines[i].split("-->");
    return { start: toSec(a), end: toSec(b), text: lines.slice(i + 1).join("\n") };
  }).filter((c) => c && c.text);
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
    const fin = op.fade_in === undefined ? 0 : num(op.fade_in, "fade_in", 0, 30);
    const fout = op.fade_out === undefined ? 0 : num(op.fade_out, "fade_out", 0, 30);
    const delay = op.start === undefined ? 0 : num(op.start, "start", 0, 3600);
    const chain = [`volume=${vol}`];
    if (delay) chain.push(`adelay=${Math.round(delay * 1000)}:all=1`);
    if (fin) chain.push(`afade=t=in:st=${delay}:d=${fin}`);
    if (fout) chain.push(`afade=t=out:st=${Math.max(0, info.duration - fout)}:d=${fout}`);
    const music = `[1:a]${chain.join(",")}[m]`;
    const input = ["-y", "-i", cur, ...(op.loop ? ["-stream_loop", "-1"] : []), "-i", audio];
    const done = ["-c:v", "copy", ...AENC, "-t", String(info.duration), out];
    if (info.hasAudio && op.duck) {
      // music gets quieter while the original audio (speech) is playing
      const g = `${music};[0:a]asplit=2[orig][sc];[m][sc]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=400[d];[orig][d]amix=inputs=2:duration=first:normalize=0[a]`;
      return [...input, "-filter_complex", g, "-map", "0:v", "-map", "[a]", ...done];
    }
    if (info.hasAudio) {
      const g = `${music};[0:a][m]amix=inputs=2:duration=first:normalize=0[a]`;
      return [...input, "-filter_complex", g, "-map", "0:v", "-map", "[a]", ...done];
    }
    return [...input, "-filter_complex", music, "-map", "0:v", "-map", "[m]", ...done];
  },

  async text(op, cur, out, ctx, info) {
    if (!op.text || typeof op.text !== "string") throw new Error("text: \"text\" is required");
    if (op.text.length > 500) throw new Error("text: at most 500 characters");
    const vf = await drawtext({ ...op, info, tmpDir: ctx.tmpDir, key: `t${Date.now()}` });
    ctx.cwd = ctx.tmpDir;
    return ["-y", "-i", cur, "-vf", vf, ...VENC, ...(info.hasAudio ? ["-c:a", "copy"] : ["-an"]), out];
  },

  async subtitles(op, cur, out, ctx, info) {
    let cues = op.cues;
    if (!cues && op.file) cues = parseSrt(await readFile(resolveInside(ctx, op.file), "utf8"));
    if (!Array.isArray(cues) || !cues.length) throw new Error("subtitles: give \"cues\" [{start,end,text}] or an .srt \"file\"");
    if (cues.length > 200) throw new Error("subtitles: at most 200 cues");
    const filters = [];
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (!c || typeof c.text !== "string") throw new Error(`subtitles: cue ${i + 1} needs text`);
      filters.push(await drawtext({
        text: c.text, start: c.start, end: c.end, position: op.position || "bottom",
        size: op.size ?? 0.045, textColor: op.color, boxColor: op.box_color, info, tmpDir: ctx.tmpDir, key: `c${Date.now()}-${i}`,
      }));
    }
    ctx.cwd = ctx.tmpDir;
    return ["-y", "-i", cur, "-vf", filters.join(","), ...VENC, ...(info.hasAudio ? ["-c:a", "copy"] : ["-an"]), out];
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
    "Edit a video in the workspace by applying operations in order, then save the result. Operations: trim {start,end}, reframe {aspect: 16:9|9:16|1:1}, speed {factor 0.25-4}, fade {in,out seconds}, mute {}, add_audio {file, volume, loop, fade_in, fade_out, start, duck} (music mixing; duck lowers music under speech), append {file}, text {text, start, end, position: top|center|bottom, size 0.02-0.2 of height, color, box_color} (title/caption overlay), subtitles {cues:[{start,end,text}] or file:.srt, position, size, color}. Returns the output path and new duration.",
  input_schema: {
    type: "object",
    properties: {
      input: { type: "string", description: "Path of the source video inside the workspace" },
      operations: {
        type: "array",
        description: "List of { op: 'trim' | 'reframe' | 'speed' | 'fade' | 'mute' | 'add_audio' | 'append' | 'text' | 'subtitles', ...params }",
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
    const opCtx = { ...ctx, notes, tmpDir };
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
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { cwd: opCtx.cwd });
        opCtx.cwd = undefined;
        cur = out;
      }
      await rename(cur, finalPath);
    } finally {
      await Promise.all(temps.map((t) => rm(t, { force: true })));
      await Promise.all((await readdir(tmpDir)).filter((f) => f.startsWith("txt-")).map((f) => rm(path.join(tmpDir, f), { force: true })));
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
