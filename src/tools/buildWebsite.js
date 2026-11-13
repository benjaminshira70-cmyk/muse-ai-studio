import path from "node:path";
import { copyFile, writeFile } from "node:fs/promises";
import { ensureDir, resolveInside } from "../util.js";

const h = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function safeUrl(u) {
  const url = String(u ?? "#").trim();
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !["http", "https", "mailto", "tel"].includes(scheme[1].toLowerCase())) return "#";
  return url;
}

const CSS = (accent) => `
:root{--accent:${accent};--bg:#fff;--fg:#0f172a;--muted:#64748b;--card:#f8fafc;--line:#e2e8f0}
@media(prefers-color-scheme:dark){:root[data-mode=auto]{--bg:#0b1020;--fg:#e8ecf5;--muted:#9aa6bd;--card:#131a2e;--line:#232c46}}
:root[data-mode=dark]{--bg:#0b1020;--fg:#e8ecf5;--muted:#9aa6bd;--card:#131a2e;--line:#232c46}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit}img{max-width:100%;display:block}
.wrap{max-width:1100px;margin:0 auto;padding:0 20px}
header.nav{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
header.nav .wrap{display:flex;align-items:center;justify-content:space-between;height:64px;gap:16px}
.brand{font-weight:700;text-decoration:none;font-size:18px}
nav{display:flex;gap:18px;flex-wrap:wrap}nav a{text-decoration:none;color:var(--muted);font-size:15px}nav a:hover{color:var(--fg)}
section{padding:72px 0}
h1{font-size:clamp(34px,6vw,60px);line-height:1.08;margin:0 0 16px;letter-spacing:-.02em}
h2{font-size:clamp(26px,4vw,38px);margin:0 0 12px;letter-spacing:-.01em}
.lead{font-size:clamp(17px,2.2vw,21px);color:var(--muted);max-width:640px}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:22px}
.hero .wrap{display:grid;gap:40px;align-items:center}
@media(min-width:860px){.hero.has-img .wrap{grid-template-columns:1.1fr .9fr}}
.hero img{border-radius:16px;border:1px solid var(--line)}
.grid{display:grid;gap:20px;margin-top:32px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px}
.card h3{margin:0 0 8px;font-size:18px}.card p{margin:0;color:var(--muted)}
.icon{font-size:26px;margin-bottom:10px}
.gallery img{border-radius:12px;width:100%;aspect-ratio:4/3;object-fit:cover;border:1px solid var(--line)}
.quote p{font-size:17px;color:var(--fg)}.quote small{color:var(--muted)}
.plan.hl{border:2px solid var(--accent)}.price{font-size:34px;font-weight:700;margin:8px 0}
.plan ul{padding-left:18px;color:var(--muted);margin:12px 0 0}
details{border-bottom:1px solid var(--line);padding:16px 0}summary{cursor:pointer;font-weight:600}details p{color:var(--muted);margin:10px 0 0}
.band{background:var(--accent);color:#fff;border-radius:20px;padding:48px 28px;text-align:center}
.band .btn{background:#fff;color:var(--accent)}.band p{opacity:.9;margin:0 auto;max-width:560px}
footer{border-top:1px solid var(--line);padding:32px 0;color:var(--muted);font-size:14px;text-align:center}
`;

export default {
  name: "build_website",
  description:
    "Build a complete, responsive, professional static website (single index.html with built-in styling, light/dark support, no external dependencies) from a structured description. Section types: hero {headline, subheadline, cta{label,url}, image}, features {title, items[{icon,title,text}]}, gallery {title, images[{src,alt}]}, testimonials {title, items[{quote,name,role}]}, pricing {title, plans[{name,price,features[],cta{label,url},highlight}]}, faq {title, items[{q,a}]}, cta {headline, text, button{label,url}}, text {title, body}. Any section may have nav (a menu label). Image src can be a workspace path from generate_image or an https URL.",
  input_schema: {
    type: "object",
    properties: {
      site_name: { type: "string", description: "Folder name for the site, e.g. coffee-shop" },
      title: { type: "string", description: "Brand / site title" },
      description: { type: "string", description: "Meta description for search engines" },
      accent: { type: "string", description: "Accent colour as hex, e.g. #6d28d9" },
      mode: { type: "string", enum: ["auto", "light", "dark"], description: "Colour mode (default auto)" },
      sections: { type: "array", description: "Ordered list of sections, each { type, ...fields }" },
      footer: { type: "string", description: "Footer text" },
    },
    required: ["site_name", "title", "sections"],
  },
  async handler(input, ctx) {
    const { site_name, title, description = "", mode = "auto", footer = "", sections } = input;
    const accent = /^#[0-9a-f]{3,8}$/i.test(input.accent || "") ? input.accent : "#6d28d9";
    if (!sections.length) throw new Error("sections must not be empty");
    if (sections.length > 30) throw new Error("At most 30 sections");

    const siteDir = resolveInside(ctx, path.join("sites", site_name.replace(/[^\w-]/g, "_")));
    const assetDir = path.join(siteDir, "assets");
    await ensureDir(assetDir);
    const copied = new Set();

    // Local images are copied next to the site so the folder is self-contained.
    const img = async (src) => {
      const s = String(src || "");
      if (!s) return "";
      if (/^https:\/\//i.test(s)) return s;
      if (/^[a-z]+:/i.test(s)) throw new Error(`Unsupported image source: ${s}`);
      const from = resolveInside(ctx, s);
      const base = path.basename(from);
      if (!copied.has(base)) {
        await copyFile(from, path.join(assetDir, base));
        copied.add(base);
      }
      return `assets/${base}`;
    };

    const nav = [];
    const body = [];
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i] || {};
      const id = `s${i + 1}`;
      if (s.nav) nav.push(`<a href="#${id}">${h(s.nav)}</a>`);
      const btn = (b) => (b?.label ? `<a class="btn" href="${h(safeUrl(b.url))}">${h(b.label)}</a>` : "");
      const heading = s.title ? `<h2>${h(s.title)}</h2>` : "";
      switch (s.type) {
        case "hero": {
          const src = await img(s.image);
          body.push(
            `<section id="${id}" class="hero${src ? " has-img" : ""}"><div class="wrap"><div><h1>${h(s.headline)}</h1>` +
              `<p class="lead">${h(s.subheadline)}</p>${btn(s.cta)}</div>` +
              (src ? `<img src="${h(src)}" alt="${h(s.image_alt || s.headline)}">` : "") +
              `</div></section>`
          );
          break;
        }
        case "features":
          body.push(
            `<section id="${id}"><div class="wrap">${heading}<div class="grid">` +
              (s.items || []).map((it) => `<div class="card">${it.icon ? `<div class="icon">${h(it.icon)}</div>` : ""}<h3>${h(it.title)}</h3><p>${h(it.text)}</p></div>`).join("") +
              `</div></div></section>`
          );
          break;
        case "gallery": {
          const imgs = [];
          for (const g of s.images || []) imgs.push(`<img src="${h(await img(g.src))}" alt="${h(g.alt)}" loading="lazy">`);
          body.push(`<section id="${id}" class="gallery"><div class="wrap">${heading}<div class="grid">${imgs.join("")}</div></div></section>`);
          break;
        }
        case "testimonials":
          body.push(
            `<section id="${id}"><div class="wrap">${heading}<div class="grid">` +
              (s.items || []).map((t) => `<div class="card quote"><p>“${h(t.quote)}”</p><small>${h(t.name)}${t.role ? ` · ${h(t.role)}` : ""}</small></div>`).join("") +
              `</div></div></section>`
          );
          break;
        case "pricing":
          body.push(
            `<section id="${id}"><div class="wrap">${heading}<div class="grid">` +
              (s.plans || []).map((p) =>
                `<div class="card plan${p.highlight ? " hl" : ""}"><h3>${h(p.name)}</h3><div class="price">${h(p.price)}</div>` +
                `<ul>${(p.features || []).map((f) => `<li>${h(f)}</li>`).join("")}</ul>${btn(p.cta)}</div>`).join("") +
              `</div></div></section>`
          );
          break;
        case "faq":
          body.push(
            `<section id="${id}"><div class="wrap">${heading}` +
              (s.items || []).map((q) => `<details><summary>${h(q.q)}</summary><p>${h(q.a)}</p></details>`).join("") +
              `</div></section>`
          );
          break;
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

    const html =
      `<!doctype html><html lang="en" data-mode="${h(mode)}"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)}</title>` +
      `<meta name="description" content="${h(description)}"><meta property="og:title" content="${h(title)}">` +
      `<style>${CSS(accent)}</style></head><body>` +
      `<header class="nav"><div class="wrap"><a class="brand" href="#">${h(title)}</a><nav>${nav.join("")}</nav></div></header>` +
      `<main>${body.join("\n")}</main>` +
      `<footer><div class="wrap">${h(footer || `© ${new Date().getFullYear()} ${title}`)}</div></footer></body></html>`;

    const file = path.join(siteDir, "index.html");
    await writeFile(file, html);
    return {
      path: path.relative(resolveInside(ctx, "."), file),
      sections: sections.length,
      assets: [...copied],
      bytes: Buffer.byteLength(html),
    };
  },
};
