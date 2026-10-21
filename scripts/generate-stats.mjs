import { writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USER = process.env.STATS_USER || process.env.GITHUB_REPOSITORY_OWNER || "iaalcantara17";
const TOKEN = process.env.GITHUB_TOKEN;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "assets");
const MAX_LANGS = 8;

const THEMES = {
  light: {
    file: "stats-light.svg",
    bg: "#F6F8FC",
    glowA: "#C9D8FF",
    glowB: "#BDEBE3",
    border: "#14213D",
    ink: "#14213D",
    muted: "#55637F",
    track: "#E3E8F2",
    palette: ["#2563EB", "#0EA5A4", "#F59E0B", "#E11D48", "#7C3AED", "#16A34A", "#0891B2", "#DB2777"],
    other: "#94A3B8",
  },
  dark: {
    file: "stats-dark.svg",
    bg: "#0B1220",
    glowA: "#1D4ED8",
    glowB: "#0F766E",
    border: "#E6EDF7",
    ink: "#E6EDF7",
    muted: "#A9B6CC",
    track: "#1C2740",
    palette: ["#60A5FA", "#2DD4BF", "#FBBF24", "#FB7185", "#A78BFA", "#4ADE80", "#22D3EE", "#F472B6"],
    other: "#64748B",
  },
};

async function api(path) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": `${USER}-profile-stats`, "X-GitHub-Api-Version": "2022-11-28" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);
  return res.json();
}

async function listRepos() {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await api(`/users/${USER}/repos?type=owner&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("Unexpected repo list response");
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((r) => !r.fork && !r.private);
}

async function collect() {
  const repos = await listRepos();
  const totals = new Map();
  for (const repo of repos) {
    const langs = await api(`/repos/${repo.full_name}/languages`);
    for (const [name, bytes] of Object.entries(langs)) totals.set(name, (totals.get(name) || 0) + bytes);
  }
  const stars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  if (repos.length === 0 || sum === 0) throw new Error("No public repos or language data found");
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, MAX_LANGS).map(([name, bytes]) => ({ name, share: bytes / sum }));
  const rest = sorted.slice(MAX_LANGS).reduce((a, [, bytes]) => a + bytes, 0);
  if (rest > 0) top.push({ name: "Other", share: rest / sum, other: true });
  return { repoCount: repos.length, stars, langs: top };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (share) => `${(share * 100).toFixed(1)}%`;
const FONT = `-apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif`;

function render(data, t) {
  const W = 1000;
  const barX = 48;
  const barW = W - 96;
  const cols = 3;
  const rows = Math.ceil(data.langs.length / cols);
  const H = 166 + rows * 34;
  const colorOf = (l, i) => (l.other ? t.other : t.palette[i % t.palette.length]);

  let x = barX;
  const segments = data.langs
    .map((l, i) => {
      const w = l.share * barW;
      const seg = `<rect x="${x.toFixed(2)}" y="104" width="${Math.max(w, 0.5).toFixed(2)}" height="14" fill="${colorOf(l, i)}"/>`;
      x += w;
      return seg;
    })
    .join("\n      ");

  const legend = data.langs
    .map((l, i) => {
      const cx = barX + (i % cols) * (barW / cols);
      const cy = 160 + Math.floor(i / cols) * 34;
      return `<g transform="translate(${cx.toFixed(2)} ${cy})">
      <circle cx="6" cy="-5" r="6" fill="${colorOf(l, i)}"/>
      <text class="lang" x="22" y="0">${esc(l.name)}</text>
      <text class="pct" x="${(barW / cols - 24).toFixed(2)}" y="0" text-anchor="end">${pct(l.share)}</text>
    </g>`;
    })
    .join("\n    ");

  const repoLabel = data.repoCount === 1 ? "public repo" : "public repos";
  const starLabel = data.stars === 1 ? "star" : "stars";
  const showStars = data.stars > 0;
  const repoX = showStars ? W - 48 - 150 : W - 48;
  const counts = [
    `<text class="num" x="${repoX}" y="58" text-anchor="end">${data.repoCount}</text>`,
    `<text class="label" x="${repoX}" y="84" text-anchor="end">${repoLabel}</text>`,
    ...(showStars ? [`<text class="num" x="${W - 48}" y="58" text-anchor="end">${data.stars}</text>`, `<text class="label" x="${W - 48}" y="84" text-anchor="end">${starLabel}</text>`] : []),
  ].join("\n  ");
  const summary = data.langs.map((l) => `${l.name} ${pct(l.share)}`).join(", ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">
  <title id="title">Languages across my public repos</title>
  <desc id="desc">${esc(`${data.repoCount} ${repoLabel}${showStars ? ` and ${data.stars} ${starLabel}` : ""}. Languages by code size: ${summary}.`)}</desc>
  <defs>
    <radialGradient id="g1" cx="0.1" cy="0" r="0.6">
      <stop offset="0" stop-color="${t.glowA}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${t.glowA}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="0.95" cy="1" r="0.6">
      <stop offset="0" stop-color="${t.glowB}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${t.glowB}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="20"/></clipPath>
    <clipPath id="bar"><rect x="${barX}" y="104" width="${barW}" height="14" rx="7"/></clipPath>
  </defs>
  <style>
    .title { font: 700 26px ${FONT}; fill: ${t.ink}; letter-spacing: -0.4px; }
    .note { font: 400 15px ${FONT}; fill: ${t.muted}; }
    .num { font: 700 26px ${FONT}; fill: ${t.ink}; }
    .label { font: 400 15px ${FONT}; fill: ${t.muted}; }
    .lang { font: 500 16px ${FONT}; fill: ${t.ink}; }
    .pct { font: 400 16px ${FONT}; fill: ${t.muted}; }
  </style>
  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="${t.bg}"/>
    <rect width="${W}" height="${H}" fill="url(#g1)"/>
    <rect width="${W}" height="${H}" fill="url(#g2)"/>
    <rect x="0.75" y="0.75" width="${W - 1.5}" height="${H - 1.5}" rx="19.5" fill="none" stroke="${t.border}" stroke-opacity="0.08" stroke-width="1.5"/>
  </g>
  <text class="title" x="${barX}" y="58">Languages across my public repos</text>
  <text class="note" x="${barX}" y="84">Share of code by size, including archived repos</text>
  ${counts}
  <rect x="${barX}" y="104" width="${barW}" height="14" rx="7" fill="${t.track}"/>
  <g clip-path="url(#bar)">
      ${segments}
  </g>
  ${legend}
</svg>
`;
}

try {
  const data = await collect();
  const files = Object.values(THEMES).map((t) => ({ path: join(OUT_DIR, t.file), svg: render(data, t) }));
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of files) writeFileSync(`${f.path}.tmp`, f.svg);
  for (const f of files) renameSync(`${f.path}.tmp`, f.path);
  console.log(`Wrote stats for ${data.repoCount} repos, ${data.stars} stars, ${data.langs.length} language groups`);
} catch (err) {
  console.error(`Stats not updated: ${err.message}`);
  process.exit(1);
}
