import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export function workspaceDir(ctx = {}) {
  return path.resolve(ctx.workDir || process.env.MUSE_WORKSPACE || "./workspace");
}

/** Resolve a user/model supplied path and refuse anything outside the workspace. */
export function resolveInside(ctx, p) {
  const root = workspaceDir(ctx);
  const full = path.resolve(root, String(p));
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Path escapes the workspace: ${p}`);
  }
  return full;
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export function run(cmd, args, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} could not start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(`${cmd} failed (exit ${code}): ${err.split("\n").slice(-8).join("\n")}`));
    });
  });
}

export async function probe(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", file,
  ]);
  const info = JSON.parse(stdout);
  const v = info.streams.find((s) => s.codec_type === "video");
  const a = info.streams.find((s) => s.codec_type === "audio");
  return {
    duration: Number(info.format.duration) || 0,
    width: v?.width ?? null,
    height: v?.height ?? null,
    hasVideo: Boolean(v),
    hasAudio: Boolean(a),
    sizeBytes: Number(info.format.size) || 0,
  };
}

export function validate(schema, input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Input must be an object");
  }
  for (const key of schema.required || []) {
    if (input[key] === undefined) throw new Error(`Missing required field: ${key}`);
  }
  for (const [key, spec] of Object.entries(schema.properties || {})) {
    const val = input[key];
    if (val === undefined) continue;
    const t = spec.type;
    const ok =
      t === "array" ? Array.isArray(val)
      : t === "integer" ? Number.isInteger(val)
      : t === "object" ? typeof val === "object" && val !== null && !Array.isArray(val)
      : typeof val === t;
    if (!ok) throw new Error(`Field "${key}" must be of type ${t}`);
    if (spec.enum && !spec.enum.includes(val)) {
      throw new Error(`Field "${key}" must be one of: ${spec.enum.join(", ")}`);
    }
  }
}
