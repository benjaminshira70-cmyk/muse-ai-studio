import { registerTool } from "./registry.js";
import buildWebsite from "./tools/buildWebsite.js";
import generateImage from "./tools/generateImage.js";
import generateVideo from "./tools/generateVideo.js";
import editVideo from "./tools/editVideo.js";
import videoInfo from "./tools/videoInfo.js";

for (const t of [buildWebsite, generateImage, generateVideo, editVideo, videoInfo]) registerTool(t);

export { listTools, callTool, callToolSafe, registerTool } from "./registry.js";
