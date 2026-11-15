// GitHub'daki herkese açık projelerinden data.json üretir (GitHub Actions içinde çalışır).
// Sayfa bu dosyayı okuduğu için ziyaretçilerin tarayıcısı GitHub'ın istek sınırına takılmaz.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const USER = process.env.GH_USER || 'CehennemGibiyim';
const TOKEN = process.env.GITHUB_TOKEN || '';
const API = process.env.GH_API || 'https://api.github.com';
const H = { 'User-Agent': 'portfolio-data', Accept: 'application/vnd.github+json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) };

async function get(path, accept) {
  try {
    const r = await fetch(API + path, { headers: accept ? { ...H, Accept: accept } : H });
    if (!r.ok) return null;
    return accept ? await r.text() : await r.json();
  } catch { return null; }
}

// Dosya adından işletim sistemi (index.html içindekiyle aynı kural)
function osOf(name) {
  const n = name.toLowerCase();
  if (/\.(sha256|sha512|sha1|md5|sig|asc|blockmap|ya?ml|txt|json|pdb)$/.test(n)) return null;
  if (/\.(exe|msi|msix|msixbundle|appx|appxbundle)$/.test(n)) return 'windows';
  if (/\.(dmg|pkg)$/.test(n)) return 'macos';
  if (/\.(appimage|deb|rpm|snap|flatpak)$/.test(n)) return 'linux';
  if (/\.(apk|aab)$/.test(n)) return 'android';
  if (/\.(zip|7z|rar|tar\.gz|tgz|tar\.xz|gz)$/.test(n)) {
    if (/mac|osx|darwin/.test(n)) return 'macos';
    if (/linux/.test(n)) return 'linux';
    if (/android/.test(n)) return 'android';
    if (/win|x64|x86/.test(n)) return 'windows';
    return 'other';
  }
  return null;
}

// README'nin ilk anlamlı cümlesi (GitHub açıklaması boşsa kullanılır)
function readmeSummary(md) {
  if (!md) return '';
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  for (const raw of lines) {
    let t = raw.trim();
    if (!t || /^(#|>|\||[-*+] |\d+\.|```|!\[|\[!\[|<)/.test(t) || /^[-=_*]{3,}$/.test(t)) continue;
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_~]/g, '').replace(/<[^>]+>/g, '').trim();
    if (t.length < 12) continue;
    return t.length > 180 ? t.slice(0, 177).trimEnd() + '…' : t;
  }
  const h = lines.find((l) => /^#{1,3}\s+\S/.test(l));
  return h ? h.replace(/^#+\s+/, '').replace(/[`*_]/g, '').trim() : '';
}

// Depodaki simge dosyası: icon / logo / favicon / app-icon (png, svg, ico, webp, jpg)
const ICON_RE = /(^|\/)(app-?icon|icon|logo|favicon)[-_]?\d*\.(png|svg|ico|webp|jpg|jpeg)$/i;
function pickIcon(tree) {
  const files = (tree || []).filter((f) => f.type === 'blob' && ICON_RE.test(f.path) && !/node_modules|\.git\//.test(f.path));
  const score = (f) => f.path.split('/').length * 10 + (/\.(png|svg|webp)$/i.test(f.path) ? 0 : 5) + (/favicon/i.test(f.path) ? 3 : 0);
  files.sort((a, b) => score(a) - score(b));
  return files[0] ? files[0].path : '';
}
// Depoda simge yoksa projenin sitesindeki favicon
async function siteIcon(site) {
  try {
    const r = await fetch(site, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return '';
    const html = await r.text();
    const tag = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i) || html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]*>/i);
    const href = tag && tag[0].match(/href=["']([^"']+)["']/i);
    if (!href) return '';
    if (href[1].startsWith('data:')) return href[1].length < 30000 ? href[1] : '';
    return new URL(href[1], site).href;
  } catch { return ''; }
}

async function releaseOf(name) {
  const list = await get(`/repos/${USER}/${name}/releases?per_page=5`);
  const r = (list || []).find((x) => !x.draft);
  if (!r) return null;
  const assets = (r.assets || [])
    .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size, downloads: a.download_count, os: osOf(a.name) }))
    .filter((a) => a.os);
  return { tag: r.tag_name || r.name || '', name: r.name || '', url: r.html_url, pre: !!r.prerelease, date: r.published_at || '', assets };
}

async function build(r) {
  const [langs, release, readme, tree] = await Promise.all([
    get(`/repos/${USER}/${r.name}/languages`),
    releaseOf(r.name),
    get(`/repos/${USER}/${r.name}/readme`, 'application/vnd.github.raw+json'),
    get(`/repos/${USER}/${r.name}/git/trees/${encodeURIComponent(r.default_branch)}?recursive=1`),
  ]);
  let site = (r.homepage || '').trim();
  if (site && !/^https?:\/\//i.test(site)) site = 'https://' + site;
  if (!site && r.has_pages) site = `https://${USER.toLowerCase()}.github.io/${encodeURIComponent(r.name)}/`;

  const path = pickIcon(tree && tree.tree);
  let icon = '';
  if (path) {
    const enc = path.split('/').map(encodeURIComponent).join('/');
    // raw.githubusercontent SVG'yi resim olarak göstermez; SVG için jsDelivr kullanılır
    icon = /\.svg$/i.test(path)
      ? `https://cdn.jsdelivr.net/gh/${USER}/${r.name}@${r.default_branch}/${enc}`
      : `https://raw.githubusercontent.com/${USER}/${r.name}/${r.default_branch}/${enc}`;
  } else if (site) icon = await siteIcon(site);

  return {
    name: r.name, url: r.html_url, description: r.description || '', readme: readmeSummary(readme),
    language: r.language || '', langs: langs || {}, topics: r.topics || [], stars: r.stargazers_count || 0,
    created_at: r.created_at, pushed_at: r.pushed_at, homepage: r.homepage || '', site, icon, release,
  };
}

const all = [];
for (let page = 1; ; page++) {
  const l = await get(`/users/${USER}/repos?per_page=100&sort=pushed&page=${page}`);
  if (!l || !l.length) break;
  all.push(...l);
  if (l.length < 100) break;
}
if (!all.length) { console.error('Depo listesi alınamadı; data.json değiştirilmedi.'); process.exit(1); }

const own = all.filter((r) => !r.fork && !r.archived && r.name.toLowerCase() !== `${USER}.github.io`.toLowerCase());
const repos = [];
for (let i = 0; i < own.length; i += 5) repos.push(...(await Promise.all(own.slice(i, i + 5).map(build))));
repos.sort((a, b) => b.pushed_at.localeCompare(a.pushed_at));

// Hiçbir şey değişmediyse dosyayı yeniden yazma (gereksiz commit olmasın)
const old = existsSync('data.json') ? JSON.parse(readFileSync('data.json', 'utf8')) : null;
if (old && JSON.stringify(old.repos) === JSON.stringify(repos)) { console.log('Değişiklik yok.'); process.exit(0); }
writeFileSync('data.json', JSON.stringify({ generated: new Date().toISOString(), user: USER, repos }, null, 1));
console.log(`${repos.length} proje yazıldı.`);
