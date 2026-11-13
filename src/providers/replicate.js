const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a Replicate model and return the first output URL.
 * model is "owner/name". Input field names differ per model, so callers pass what the model expects.
 */
export async function replicateRun({ model, input, timeoutMs = 15 * 60 * 1000 }) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set");
  if (!model) throw new Error("Replicate model is not set (use owner/name)");
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  let res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST", headers, body: JSON.stringify({ input }),
  });
  let pred = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Replicate error ${res.status}: ${pred?.detail || "unknown"}`);
  const deadline = Date.now() + timeoutMs;
  while (!["succeeded", "failed", "canceled"].includes(pred.status)) {
    if (Date.now() > deadline) throw new Error("Generation timed out");
    await sleep(3000);
    res = await fetch(pred.urls.get, { headers });
    pred = await res.json();
  }
  if (pred.status !== "succeeded") throw new Error(`Generation ${pred.status}: ${pred.error || ""}`);
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!url || typeof url !== "string") throw new Error("Replicate returned no output URL");
  return url;
}

export async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
