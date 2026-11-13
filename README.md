# Muse AI Studio

A tool pack that gives Muse AI the power to build websites, generate images and videos, and edit videos.
Zero dependencies. Needs Node 18+ and `ffmpeg` installed.

## Tools

| Tool | What it does |
|---|---|
| `build_website` | Builds a responsive, light/dark-aware static site (one `index.html`) from a list of sections: hero, features, gallery, testimonials, pricing, faq, cta, text |
| `generate_image` | Text to image (providers: `mock`, `openai`) |
| `generate_video` | Text/image to short video (providers: `mock`, `replicate`) |
| `edit_video` | Chain of edits in one call: trim, reframe (16:9 / 9:16 / 1:1), speed, fade, mute, add_audio, append |
| `video_info` | Duration, resolution, audio check |

All files are read and written inside `MUSE_WORKSPACE` only. Paths that try to escape it are rejected.

## Plug into Muse AI

```js
import { listTools, callToolSafe } from "./src/index.js";

// 1. Give the model the tool list (Anthropic format, or "openai")
const tools = listTools("anthropic");

// 2. When the model calls a tool, run it and send the result back
const result = await callToolSafe(toolName, toolInput, { workDir: "./workspace" });
// result = { ok: true, result: {...} } or { ok: false, error: "..." }
```

Add your own tool with `registerTool({ name, description, input_schema, handler })`.

## Setup

```bash
cp .env.example .env   # then fill in keys for the real providers
npm test               # 9 tests, runs offline
node src/cli.js list   # print tool definitions
node src/cli.js call generate_image '{"prompt":"a red fox"}'
```

The default `mock` providers work offline with no keys, so you can test the whole flow first.

## Status

- Tested offline: the registry, path safety, website builder, all video editing, and the mock providers.
- **Not yet tested against live APIs:** the `openai` image adapter and the `replicate` video adapter (they need your API keys). Try them with a real key and check the first result.
