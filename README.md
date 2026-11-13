# Muse AI Studio

A tool pack that lets an AI assistant (like Muse) build websites, generate images and videos, and edit videos.
Zero dependencies. Needs Node 18+ and `ffmpeg`.

## Tools

| Tool | What it does |
|---|---|
| `build_website` | Builds a responsive static site (`index.html` + `assets/`, works offline). 5 themes: modern, minimal, bold (dark), elegant (cream), playful. 14 section types: hero, features, stats, steps, logos, gallery, video, team, testimonials, pricing, faq, contact, cta, text |
| `generate_image` | Text to image. Providers: `mock`, `openai`, `replicate` |
| `generate_video` | Text/image to short video. Providers: `mock`, `replicate` |
| `edit_video` | Chain of edits in one call: trim, reframe (16:9 / 9:16 / 1:1), speed, fade, mute, append, **text** (titles/captions), **subtitles** (cues or .srt), **add_audio** (music with loop, fades, start offset, ducking under speech) |
| `video_info` | Duration, resolution, audio check |
| `check_setup` | Diagnoses ffmpeg, fonts, providers and missing API keys (never shows key values). Run it first if something fails |

All files are read and written inside `MUSE_WORKSPACE` only. Paths that try to escape it are rejected, and websites only copy image/video files.

## Use it as an MCP server (Muse, Claude, any MCP client)

```bash
npx -y github:benjaminshira70-cmyk/muse-ai-studio
```

```json
{
  "mcpServers": {
    "muse-ai-studio": {
      "command": "npx",
      "args": ["-y", "github:benjaminshira70-cmyk/muse-ai-studio"],
      "env": {
        "MUSE_WORKSPACE": "/path/to/workspace",
        "MUSE_IMAGE_PROVIDER": "replicate",
        "MUSE_IMAGE_MODEL": "owner/image-model",
        "MUSE_VIDEO_PROVIDER": "replicate",
        "MUSE_VIDEO_MODEL": "owner/video-model",
        "REPLICATE_API_TOKEN": "..."
      }
    }
  }
}
```

Files go to `MUSE_WORKSPACE` (default `~/muse-workspace`). The machine running the server needs `ffmpeg`.

## Turn on real image and video generation

By default both use offline `mock` placeholders. To switch:

| You want | Set these |
|---|---|
| Real images via OpenAI | `MUSE_IMAGE_PROVIDER=openai`, `OPENAI_API_KEY` (model defaults to `gpt-image-1`, override with `MUSE_IMAGE_MODEL`) |
| Real images via Replicate | `MUSE_IMAGE_PROVIDER=replicate`, `REPLICATE_API_TOKEN`, `MUSE_IMAGE_MODEL=owner/name` |
| Real videos via Replicate | `MUSE_VIDEO_PROVIDER=replicate`, `REPLICATE_API_TOKEN`, `MUSE_VIDEO_MODEL=owner/name` |

Keep keys out of chat history and out of git: enter them through your platform's secret/credential prompt, or in a local `.env` (already git-ignored). Then call `check_setup` to confirm nothing is missing.

## Use it in code

```js
import { listTools, callToolSafe } from "./src/index.js";

const tools = listTools("anthropic");            // or "openai"
const out = await callToolSafe(name, input, { workDir: "./workspace" });
// { ok: true, result: {...} } or { ok: false, error: "..." }
```

Add your own tool with `registerTool({ name, description, input_schema, handler })`.

## Develop

```bash
cp .env.example .env
npm test                # 17 tests, run offline
node src/cli.js list    # print tool definitions
node src/cli.js call generate_image '{"prompt":"a red fox"}'
```

Text overlays need an ffmpeg with the `drawtext` filter and a font file. A font is found automatically on Linux, macOS and Termux; otherwise set `MUSE_FONT` to a `.ttf`/`.otf` path. Windows paths are not supported for text overlays yet.

## Status

- Tested offline: registry, MCP protocol, path safety, website builder (all themes and sections), all video edits, mock providers.
- **Not tested against live APIs:** the `openai` and `replicate` adapters need your API keys. Generate one image and one short video with real keys and check the results.
