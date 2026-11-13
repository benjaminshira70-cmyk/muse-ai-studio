import path from "node:path";
import { copyFile, writeFile } from "node:fs/promises";
import { ensureDir, resolveInside } from "../util.js";

const h = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const arr = (x, max = 24) => (Array.isArray(x) ? x.slice(0, max) : []);

function safeUrl(u) {
  const url = String(u ?? "#").trim();
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !["http", "https", "mailto", "tel"].includes(scheme[1].toLowerCase())) return "#";
  return url;
}

/** Readable text colour (dark or white) for text placed on the accent colour. */
function onAccent(hex) {
  let h6 = hex.slice(1);
  if (h6.length === 3 || h6.length === 4) h6 = [...h6.slice(0, 3)].map((c) => c + c).join("");
  h6 = h6.slice(0, 6).padEnd(6, "0");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h6.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#111827" : "#ffffff";
}

const IMAGE_EXT = ["svg", "png", "jpg", "jpeg", "webp", "gif", "avif"];
const VIDEO_EXT = ["mp4", "webm", "mov"];

const BASE_CSS = (accent) => `
:root{--accent:${accent};--on:${onAccent(accent)};--bg:#fff;--fg:#0f172a;--muted:#64748b;--card:#f8fafc;--line:#e2e8f0;--radius:14px;--font:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--head:var(--font)}
@media(prefers-color-scheme:dark){:root[data-mode=auto]{--bg:#0b1020;--fg:#e8ecf5;--muted:#9aa6bd;--card:#131a2e;--line:#232c46}}
:root[data-mode=dark]{--bg:#0b1020;--fg:#e8ecf5;--muted:#9aa6bd;--card:#131a2e;--line:#232c46}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 var(--font)}
a{color:inherit}img,video{max-width:100%;display:block}
.wrap{max-width:1100px;margin:0 auto;padding:0 20px}
header.nav{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
header.nav .wrap{display:flex;align-items:center;justify-content:space-between;height:64px;gap:16px}
.brand{font-weight:700;text-decoration:none;font-size:18px;font-family:var(--head)}
nav{display:flex;gap:18px;flex-wrap:wrap}nav a{text-decoration:none;color:var(--muted);font-size:15px}nav a:hover{color:var(--fg)}
section{padding:72px 0}
h1,h2,h3{font-family:var(--head)}
h1{font-size:clamp(34px,6vw,60px);line-height:1.08;margin:0 0 16px;letter-spacing:-.02em}
h2{font-size:clamp(26px,4vw,38px);margin:0 0 12px;letter-spacing:-.01em}
.lead{font-size:clamp(17px,2.2vw,21px);color:var(--muted);max-width:640px}
.btn{display:inline-block;background:var(--accent);color:var(--on);padding:12px 22px;border-radius:calc(var(--radius)*.7);text-decoration:none;font-weight:600;margin-top:22px}
.hero .wrap{display:grid;gap:40px;align-items:center}
@media(min-width:860px){.hero.has-img .wrap{grid-template-columns:1.1fr .9fr}}
.hero img{border-radius:var(--radius);border:1px solid var(--line)}
.hero-center{text-align:center}.hero-center .lead{margin-left:auto;margin-right:auto}
.hero-center.has-img .wrap{grid-template-columns:1fr!important}
.hero-grad{background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 18%,var(--bg)),var(--bg) 70%)}
.grid{display:grid;gap:20px;margin-top:32px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px}
.card h3{margin:0 0 8px;font-size:18px}.card p{margin:0;color:var(--muted)}
.icon{font-size:26px;margin-bottom:10px}
.gallery img{border-radius:var(--radius);width:100%;aspect-ratio:4/3;object-fit:cover;border:1px solid var(--line)}
.quote p{font-size:17px;color:var(--fg)}.quote small{color:var(--muted)}
.plan.hl{border:2px solid var(--accent)}.price{font-size:34px;font-weight:700;margin:8px 0}
.plan ul{padding-left:18px;color:var(--muted);margin:12px 0 0}
details{border-bottom:1px solid var(--line);padding:16px 0}summary{cursor:pointer;font-weight:600}details p{color:var(--muted);margin:10px 0 0}
.band{background:var(--accent);color:var(--on);border-radius:calc(var(--radius)*1.4);padding:48px 28px;text-align:center}
.band .btn{background:var(--on);color:var(--accent)}.band p{opacity:.9;margin:0 auto;max-width:560px}
.stats{text-align:center}.stat b{display:block;font-size:clamp(34px,5vw,52px);line-height:1.1;color:var(--accent);font-family:var(--head)}.stat span{color:var(--muted)}
.steps{counter-reset:step}.step::before{counter-increment:step;content:counter(step);display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--accent);color:var(--on);font-weight:700;margin-bottom:12px}
.person{text-align:center}.person img{width:96px;height:96px;border-radius:50%;object-fit:cover;margin:0 auto 12px;border:1px solid var(--line)}
.logos .row{display:flex;flex-wrap:wrap;gap:12px 36px;justify-content:center;margin-top:20px;color:var(--muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:15px}
.logos h2{text-align:center;font-size:15px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase}
.video video{width:100%;border-radius:var(--radius);border:1px solid var(--line);margin-top:24px;background:#000}
.contact{text-align:center}.contact .lead{margin-left:auto;margin-right:auto}
footer{border-top:1px solid var(--line);padding:32px 0;color:var(--muted);font-size:14px;text-align:center}
footer .links{display:flex;gap:18px;justify-content:center;flex-wrap:wrap;margin-bottom:10px}footer .links a{text-decoration:none}
`;

// Fonts are system stacks only, so sites never need external requests.
const THEMES = {
  modern: "",
  minimal: `:root[data-mode]{--radius:4px;--font:Georgia,"Times New Roman",serif;--head:Georgia,"Times New Roman",serif}
h1,h2{font-weight:500}.card{background:transparent}section{padding:88px 0}.btn{border-radius:2px}`,
  bold: `:root[data-mode]{--bg:#0a0a0a;--fg:#fff;--muted:#a3a3a3;--card:#161616;--line:#2c2c2c;--radius:0px;--head:Impact,"Arial Black",system-ui,sans-serif}
h1,h2{text-transform:uppercase;font-weight:900;letter-spacing:-.02em}.card{border-width:2px}.btn{border-radius:0;text-transform:uppercase;letter-spacing:.05em}`,
  elegant: `:root[data-mode]{--bg:#faf7f2;--fg:#2b2622;--muted:#7a6f66;--card:#ffffff;--line:#e8e0d4;--radius:6px;--head:Georgia,"Times New Roman",serif}
h1,h2,h3{font-weight:500}.btn{border-radius:2px;letter-spacing:.04em}section{padding:84px 0}`,
  playful: `:root[data-mode]{--radius:24px;--font:ui-rounded,"Nunito","Segoe UI",system-ui,sans-serif}
.btn{border-radius:999px}.card{border-width:2px}h1,h2{font-weight:800}.hero{background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 16%,var(--bg)),var(--bg) 75%)}`,
};

export default {
  name: "build_website",
  description:
    "Build a complete, responsive, professional static website (one index.html plus an assets folder; no external dependencies, works offline) from a structured description. Themes: modern (default), minimal, bold (dark), elegant (cream), playful. Section types: hero {headline, subheadline, cta{label,url}, image, align:'center', background:'gradient'}, features {title, items[{icon,title,text}]}, stats {title, items[{value,label}]}, steps {title, items[{title,text}]}, logos {title, items[names]}, gallery {title, images[{src,alt}]}, video {title, src, poster}, team {title, items[{name,role,bio,image}]}, testimonials {title, items[{quote,name,role}]}, pricing {title, plans[{name,price,features[],cta{label,url},highlight}]}, faq {title, items[{q,a}]}, contact {title, text, email, button}, cta {headline, text, button{label,url}}, text {title, body}. Any section may have nav (a menu label). Image/video src can be a workspace path (e.g. from generate_image or generate_video) or an https URL.",
  input_schema: {
    type: "object",
    properties: {
      site_name: { type: "string", description: "Folder name for the site, e.g. coffee-shop" },
      title: { type: "string", description: "Brand / site title" },
      description: { type: "string", description: "Meta description for search engines" },
      theme: { type: "string", enum: Object.keys(THEMES), description: "Design theme (default modern). bold is always dark, elegant is always light." },
      accent: { type: "string", description: "Accent colour as hex, e.g. #6d28d9" },
      mode: { type: "string", enum: ["auto", "light", "dark"], description: "Colour mode (default auto); ignored by bold and elegant themes" },
      favicon: { type: "string", description: "A single emoji used as the site icon, e.g. 🦊" },
      lang: { type: "string", description: "Language code, e.g. en (default en)" },
      sections: { type: "array", description: "Ordered list of sections, each { type, ...fields }" },
      footer: { type: "string", description: "Footer text" },
      footer_links: { type: "array", description: "Footer links [{label,url}]" },
    },
    required: ["site_name", "title", "sections"],
  },
  async handler(input, ctx) {
    const { site_name, title, description = "", theme = "modern", mode = "auto", footer = "", sections } = input;
    const accent = /^#[0-9a-f]{3,8}$/i.test(input.accent || "") ? input.accent : "#6d28d9";
    if (!THEMES.hasOwnProperty(theme)) throw new Error(`Unknown theme "${theme}"`);
    if (!sections.length) throw new Error("sections must not be empty");
    if (sections.length > 30) throw new Error("At most 30 sections");

    const siteDir = resolveInside(ctx, path.join("sites", site_name.replace(/[^\w-]/g, "_")));
    const assetDir = path.join(siteDir, "assets");
    await ensureDir(assetDir);
    const copied = new Map(); // source path -> asset file name
    const names = new Set();

    // Local files are copied next to the site so the folder is self-contained.
    // Only image/video extensions are copied, so nothing else in the workspace can leak into a site.
    const asset = async (src, exts) => {
      const s = String(src || "");
      if (!s) return "";
      if (/^https:\/\//i.test(s)) return s;
      if (/^[a-z]+:/i.test(s)) throw new Error(`Unsupported source: ${s}`);
      const from = resolveInside(ctx, s);
      const ext = path.extname(from).slice(1).toLowerCase();
      if (!exts.includes(ext)) throw new Error(`File type .${ext} is not allowed here (use: ${exts.join(", ")})`);
      if (!copied.has(from)) {
        let name = path.basename(from);
        for (let n = 2; names.has(name); n++) name = `${path.basename(from, `.${ext}`)}-${n}.${ext}`;
        names.add(name);
        await copyFile(from, path.join(assetDir, name));
        copied.set(from, name);
      }
      return `assets/${copied.get(from)}`;
    };
    const img = (src) => asset(src, IMAGE_EXT);

    const nav = [];
    const body = [];
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i] || {};
      const id = `s${i + 1}`;
      if (s.nav) nav.push(`<a href="#${id}">${h(s.nav)}</a>`);
      const btn = (b) => (b?.label ? `<a class="btn" href="${h(safeUrl(b.url))}">${h(b.label)}</a>` : "");
      const heading = s.title ? `<h2>${h(s.title)}</h2>` : "";
      const gridOf = (cls, cells) => `<section id="${id}"${cls ? ` class="${cls}"` : ""}><div class="wrap">${heading}<div class="grid">${cells.join("")}</div></div></section>`;

      switch (s.type) {
        case "hero": {
          const src = await img(s.image);
          const cls = ["hero", src && "has-img", s.align === "center" && "hero-center", s.background === "gradient" && "hero-grad"].filter(Boolean).join(" ");
          body.push(
            `<section id="${id}" class="${cls}"><div class="wrap"><div><h1>${h(s.headline)}</h1>` +
              `<p class="lead">${h(s.subheadline)}</p>${btn(s.cta)}</div>` +
              (src ? `<img src="${h(src)}" alt="${h(s.image_alt || s.headline)}">` : "") +
              `</div></section>`
          );
          break;
        }
        case "features":
          body.push(gridOf("", arr(s.items).map((it) => `<div class="card">${it.icon ? `<div class="icon">${h(it.icon)}</div>` : ""}<h3>${h(it.title)}</h3><p>${h(it.text)}</p></div>`)));
          break;
        case "stats":
          body.push(gridOf("stats", arr(s.items, 8).map((it) => `<div class="stat"><b>${h(it.value)}</b><span>${h(it.label)}</span></div>`)));
          break;
        case "steps":
          body.push(gridOf("steps", arr(s.items, 8).map((it) => `<div class="card step"><h3>${h(it.title)}</h3><p>${h(it.text)}</p></div>`)));
          break;
        case "logos":
          body.push(`<section id="${id}" class="logos"><div class="wrap">${heading}<div class="row">${arr(s.items, 12).map((n) => `<span>${h(n)}</span>`).join("")}</div></div></section>`);
          break;
        case "gallery": {
          const cells = [];
          for (const g of arr(s.images)) cells.push(`<img src="${h(await img(g.src))}" alt="${h(g.alt)}" loading="lazy">`);
          body.push(gridOf("gallery", cells));
          break;
        }
        case "video": {
          const src = await asset(s.src, VIDEO_EXT);
          if (!src) throw new Error(`Section ${i + 1}: video needs "src"`);
          const poster = s.poster ? await img(s.poster) : "";
          body.push(`<section id="${id}" class="video"><div class="wrap">${heading}<video controls playsinline preload="metadata"${poster ? ` poster="${h(poster)}"` : ""} src="${h(src)}"></video></div></section>`);
          break;
        }
        case "team": {
          const cells = [];
          for (const p of arr(s.items, 12)) {
            const pic = p.image ? await img(p.image) : "";
            cells.push(`<div class="card person">${pic ? `<img src="${h(pic)}" alt="${h(p.name)}" loading="lazy">` : ""}<h3>${h(p.name)}</h3><p>${h(p.role)}</p>${p.bio ? `<p>${h(p.bio)}</p>` : ""}</div>`);
          }
          body.push(gridOf("", cells));
          break;
        }
        case "testimonials":
          body.push(gridOf("", arr(s.items).map((t) => `<div class="card quote"><p>“${h(t.quote)}”</p><small>${h(t.name)}${t.role ? ` · ${h(t.role)}` : ""}</small></div>`)));
          break;
        case "pricing":
          body.push(gridOf("", arr(s.plans, 6).map((p) =>
            `<div class="card plan${p.highlight ? " hl" : ""}"><h3>${h(p.name)}</h3><div class="price">${h(p.price)}</div>` +
            `<ul>${arr(p.features, 12).map((f) => `<li>${h(f)}</li>`).join("")}</ul>${btn(p.cta)}</div>`)));
          break;
        case "faq":
          body.push(`<section id="${id}"><div class="wrap">${heading}${arr(s.items, 20).map((q) => `<details><summary>${h(q.q)}</summary><p>${h(q.a)}</p></details>`).join("")}</div></section>`);
          break;
        case "contact": {
          if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(s.email || "")) throw new Error(`Section ${i + 1}: contact needs a valid "email"`);
          body.push(`<section id="${id}" class="contact"><div class="wrap">${heading}<p class="lead">${h(s.text)}</p><a class="btn" href="mailto:${h(s.email)}">${h(s.button || "Email us")}</a></div></section>`);
          break;
        }
        case "cta":
          body.push(`<section id="${id}"><div class="wrap"><div class="band"><h2>${h(s.headline)}</h2><p>${h(s.text)}</p>${btn(s.button)}</div></div></section>`);
          break;
        case "text":
          body.push(`<section id="${id}"><div class="wrap">${heading}<p class="lead">${h(s.body)}</p></div></section>`);
          break;
        default:
          throw new Error(`Unknown section type "${s.type}" (section ${i + 1})`);
      }
    }

    const favicon = input.favicon && [...input.favicon].length <= 4
      ? `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${h(input.favicon)}</text></svg>`)}">`
      : "";
    const links = arr(input.footer_links, 8).map((l) => `<a href="${h(safeUrl(l.url))}">${h(l.label)}</a>`).join("");
    const lang = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(input.lang || "") ? input.lang : "en";

    const html =
      `<!doctype html><html lang="${lang}" data-mode="${h(mode)}"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)}</title>` +
      `<meta name="description" content="${h(description)}"><meta property="og:title" content="${h(title)}">${favicon}` +
      `<style>${BASE_CSS(accent)}${THEMES[theme]}</style></head><body>` +
      `<header class="nav"><div class="wrap"><a class="brand" href="#">${h(title)}</a><nav>${nav.join("")}</nav></div></header>` +
      `<main>${body.join("\n")}</main>` +
      `<footer><div class="wrap">${links ? `<div class="links">${links}</div>` : ""}${h(footer || `© ${new Date().getFullYear()} ${title}`)}</div></footer></body></html>`;

    const file = path.join(siteDir, "index.html");
    await writeFile(file, html);
    return {
      path: path.relative(resolveInside(ctx, "."), file),
      theme,
      sections: sections.length,
      assets: [...copied.values()],
      bytes: Buffer.byteLength(html),
    };
  },
};
