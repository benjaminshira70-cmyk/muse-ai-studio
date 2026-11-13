import { writeFile } from "node:fs/promises";

const SIZES = { square: "1024x1024", landscape: "1536x1024", portrait: "1024x1536" };

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Offline placeholder so the whole pipeline can be tested without an API key. */
const mock = {
  ext: "svg",
  async generate({ prompt, shape, outBase }) {
    const [w, h] = SIZES[shape].split("x").map(Number);
    const file = `${outBase}.svg`;
    const text = esc(prompt).slice(0, 90);
    await writeFile(
      file,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d28d9"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs>` +
        `<rect width="100%" height="100%" fill="url(#g)"/>` +
        `<text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="36" text-anchor="middle">${text}</text></svg>`
    );
    return { file, provider: "mock" };
  },
};

const openai = {
  ext: "png",
  async generate({ prompt, shape, outBase }) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.MUSE_IMAGE_MODEL || "gpt-image-1",
        prompt,
        size: SIZES[shape],
        n: 1,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenAI image error ${res.status}: ${body?.error?.message || "unknown"}`);
    const item = body.data?.[0];
    let bytes;
    if (item?.b64_json) bytes = Buffer.from(item.b64_json, "base64");
    else if (item?.url) bytes = Buffer.from(await (await fetch(item.url)).arrayBuffer());
    else throw new Error("OpenAI returned no image data");
    const file = `${outBase}.png`;
    await writeFile(file, bytes);
    return { file, provider: "openai" };
  },
};

export const imageProviders = { mock, openai };
export const IMAGE_SHAPES = Object.keys(SIZES);
