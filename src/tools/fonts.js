import { existsSync } from "node:fs";

const CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/opentype/inter/Inter-Bold.otf",
  "/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", // Termux
  "/data/data/com.termux/files/usr/share/fonts/truetype/DejaVuSans.ttf",
  "/system/fonts/Roboto-Regular.ttf", // Android
  "/system/fonts/DroidSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf", // macOS
  "/Library/Fonts/Arial.ttf",
  "C:/Windows/Fonts/arialbd.ttf", // Windows
];

/** Font used for text overlays. Override with MUSE_FONT. Returns null if none is found. */
export function findFont() {
  const env = process.env.MUSE_FONT;
  if (env) return existsSync(env) ? env : null;
  return CANDIDATES.find((p) => existsSync(p)) || null;
}
