// Same-origin community numbers for debuganything.dev. Visitors' browsers never contact GitHub, npm or PyPI:
// this function does, once per cache window, and avatars come back inlined as data URIs.
const REPO = "shreyassaw5394/debuganything";
const PKG = "debuganything";

async function json(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "debuganything.dev", accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function avatar(url) {
  try {
    const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}s=64`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "image/png";
    if (!/^image\/(png|jpeg|gif|webp)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length < 60_000 ? `data:${type};base64,${buf.toString("base64")}` : null;
  } catch { return null; }
}

export async function buildStats() {
  const [repo, npm, pypi, contributors] = await Promise.all([
    json(`https://api.github.com/repos/${REPO}`),
    json(`https://api.npmjs.org/downloads/point/last-month/${PKG}`),
    json(`https://pypistats.org/api/packages/${PKG}/recent`),
    json(`https://api.github.com/repos/${REPO}/contributors?per_page=24`),
  ]);
  const people = Array.isArray(contributors)
    ? await Promise.all(contributors.filter((c) => c && c.type !== "Bot").slice(0, 24).map(async (c) => ({
        login: String(c.login), url: String(c.html_url), contributions: Number(c.contributions) || 0, avatar: await avatar(String(c.avatar_url)),
      })))
    : null;
  return {
    stars: repo?.stargazers_count ?? null,
    forks: repo?.forks_count ?? null,
    npm: typeof npm?.downloads === "number" ? npm.downloads : null,
    pypi: typeof pypi?.data?.last_month === "number" ? pypi.data.last_month : null,
    contributors: people,
  };
}

export default async function handler(_req, res) {
  const body = await buildStats();
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "public, s-maxage=21600, stale-while-revalidate=86400");
  res.status(200).send(JSON.stringify(body));
}
