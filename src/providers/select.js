/** Resolve which provider to use. "auto" picks the best one you have keys for, else the offline mock. */
export function pickProvider(kind, registry) {
  const requested = process.env[kind === "image" ? "MUSE_IMAGE_PROVIDER" : "MUSE_VIDEO_PROVIDER"] || "mock";
  let name = requested;
  if (requested === "auto") {
    const replicateReady = process.env.REPLICATE_API_TOKEN && process.env[kind === "image" ? "MUSE_IMAGE_MODEL" : "MUSE_VIDEO_MODEL"];
    if (kind === "image" && process.env.OPENAI_API_KEY) name = "openai";
    else if (replicateReady) name = "replicate";
    else name = "mock";
  }
  if (!registry[name]) throw new Error(`Unknown ${kind} provider: ${name}`);
  return { name, requested, provider: registry[name] };
}

/** Parse an optional JSON object from an env var (extra model-specific inputs). */
export function extraInput(envName) {
  const raw = process.env[envName];
  if (!raw) return {};
  let v;
  try { v = JSON.parse(raw); } catch { throw new Error(`${envName} must be valid JSON, e.g. {"resolution":"720p"}`); }
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${envName} must be a JSON object`);
  return v;
}

/** Snap a duration to the nearest value the model allows (MUSE_VIDEO_DURATIONS="4,6,8"). */
export function snapDuration(seconds, list = process.env.MUSE_VIDEO_DURATIONS) {
  const allowed = String(list || "").split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
  if (!allowed.length) return seconds;
  return allowed.reduce((best, n) => (Math.abs(n - seconds) < Math.abs(best - seconds) ? n : best));
}
