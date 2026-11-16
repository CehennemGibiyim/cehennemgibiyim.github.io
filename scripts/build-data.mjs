// GitHub'daki herkese açık projelerinden data.json üretir (GitHub Actions içinde çalışır).
// Sayfa bu dosyayı okuduğu için ziyaretçilerin tarayıcısı GitHub'ın istek sınırına takılmaz.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const USER = process.env.GH_USER || 'CehennemGibiyim';
const TOKEN = process.env.GITHUB_TOKEN || '';
const API = process.env.GH_API || 'https://api.github.com';
const H = { 'User-Agent': 'portfolio-data', Accept: 'application/vnd.github+json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) };

async function get(path, accept) {
  let r;
  try { r = await fetch(API + path, { headers: accept ? { ...H, Accept: accept } : H }); } catch { return null; }
  if (r.status === 403 || r.status === 429) { console.error('GitHub istek sınırına takıldı; data.json değiştirilmedi.'); process.exit(1); }
  if (!r.ok) return null;
  try { return accept ? await r.text() : await r.json(); } catch { return null; }
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

// README'nin ilk anlamlı paragrafı (GitHub açıklaması boşsa kullanılır)
function readmeSummary(md) {
  if (!md) return '';
  const clean = md.replace(/<!--[\s\S]*?-->/g, '');
  for (const para of clean.split(/\r?\n\s*\r?\n/)) {
    const lines = para.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length || /^(#|>|\||[-*+] |\d+\.|```|!\[|\[!\[|<)/.test(lines[0]) || /^[-=_*]{3,}$/.test(lines[0])) continue;
    let t = lines.join(' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (t.length < 12 || /^https?:\/\/\S+$/.test(t)) continue;
    if (t.length > 170) {
      const cut = t.slice(0, 170), i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(': '));
      t = i > 60 ? cut.slice(0, i + 1) : cut.replace(/\s+\S*$/, '') + '…';
    }
    return t;
  }
  const h = clean.split(/\r?\n/).find((l) => /^#{1,3}\s+\S/.test(l));
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

// Sürüm notu: markdown işaretlerinden arındırılmış kısa metin
function cleanNotes(md) {
  if (!md) return '';
  const t = md.replace(/<!--[\s\S]*?-->/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '').replace(/[`*_~>]/g, '').replace(/<[^>]+>/g, '').replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();
  return t.length > 400 ? t.slice(0, 397).trimEnd() + '…' : t;
}

// README'deki ekran görüntüleri (rozetler ve SVG'ler hariç, en çok 4)
const IMG_RE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)|<img[^>]+src=["']([^"']+)["']/gi;
function shotsOf(md, r) {
  if (!md) return [];
  const out = [];
  for (const m of md.matchAll(IMG_RE)) {
    let u = (m[1] || m[2] || '').trim();
    if (!u || /^data:/i.test(u) || /shields\.io|badge|badgen|travis-ci|codecov|placeholder|placehold\.co|dummyimage|\/(actions|workflows)\/|\.svg(\?|$)/i.test(u)) continue;
    if (!/^https?:/i.test(u)) u = `https://raw.githubusercontent.com/${USER}/${r.name}/${r.default_branch}/${u.replace(/^\.?\//, '')}`;
    u = u.replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\//i, 'https://github.com/$1/$2/raw/');
    if (!out.includes(u)) out.push(u);
    if (out.length >= 4) break;
  }
  return out;
}

// Releases kullanmayan projeler için: depoya doğrudan konmuş yükleyici dosyaları
const PKG_RE = /\.(exe|msi|msix|appx|dmg|pkg|appimage|deb|rpm|apk|rar|7z|zip)$/i;
function filesOf(tree, r) {
  const list = (tree || []).filter((f) => f.type === 'blob' && PKG_RE.test(f.path)
    && !/node_modules|(^|\/)(tests?|examples?|samples?)\//i.test(f.path)
    && f.size >= (/\.(zip|rar|7z)$/i.test(f.path) ? 200000 : 50000)
    && !(/\.zip$/i.test(f.path) && /source|src|backup/i.test(f.path)));
  return list.slice(0, 8).map((f) => {
    const name = f.path.split('/').pop();
    return { name, size: f.size, os: osOf(name), url: `https://github.com/${USER}/${r.name}/raw/${encodeURIComponent(r.default_branch)}/${f.path.split('/').map(encodeURIComponent).join('/')}` };
  }).filter((f) => f.os);
}

async function releaseOf(name) {
  const list = ((await get(`/repos/${USER}/${name}/releases?per_page=20`)) || []).filter((x) => !x.draft);
  const r = list.slice().sort((x, y) => new Date(y.published_at || y.created_at) - new Date(x.published_at || x.created_at))[0];
  if (!r) return null;
  const assets = (r.assets || [])
    .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size, downloads: a.download_count, os: osOf(a.name), sha256: (a.digest || '').replace(/^sha256:/, '') }))
    .filter((a) => a.os);
  const downloadsTotal = list.reduce((s, x) => s + (x.assets || []).reduce((t, y) => t + (y.download_count || 0), 0), 0);
  return { tag: r.tag_name || r.name || '', name: r.name || '', url: r.html_url, pre: !!r.prerelease, date: r.published_at || '', notes: cleanNotes(r.body), downloadsTotal, assets };
}

async function build(r) {
  const [langs, release, readme, tree, weeks] = await Promise.all([
    get(`/repos/${USER}/${r.name}/languages`),
    releaseOf(r.name),
    get(`/repos/${USER}/${r.name}/readme`, 'application/vnd.github.raw+json'),
    get(`/repos/${USER}/${r.name}/git/trees/${encodeURIComponent(r.default_branch)}?recursive=1`),
    get(`/repos/${USER}/${r.name}/stats/commit_activity`),
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
    files: filesOf(tree && tree.tree, r), shots: shotsOf(readme, r),
    activity: Array.isArray(weeks) ? weeks.slice(-12).map((w) => w.total) : [],
  };
}

const cfg = existsSync('config.json') ? JSON.parse(readFileSync('config.json', 'utf8')) : {};
const hide = (cfg.hide || []).map((x) => String(x).toLowerCase());

const all = [];
for (let page = 1; ; page++) {
  const l = await get(`/users/${USER}/repos?per_page=100&sort=pushed&page=${page}`);
  if (!l || !l.length) break;
  all.push(...l);
  if (l.length < 100) break;
}
if (!all.length) { console.error('Depo listesi alınamadı; data.json değiştirilmedi.'); process.exit(1); }

const own = all.filter((r) => !r.fork && !r.archived && r.name.toLowerCase() !== `${USER}.github.io`.toLowerCase() && !hide.includes(r.name.toLowerCase()));
const repos = [];
for (let i = 0; i < own.length; i += 5) repos.push(...(await Promise.all(own.slice(i, i + 5).map(build))));
repos.sort((a, b) => b.pushed_at.localeCompare(a.pushed_at));

// Hiçbir şey değişmediyse dosyayı yeniden yazma (gereksiz commit olmasın)
const old = existsSync('data.json') ? JSON.parse(readFileSync('data.json', 'utf8')) : null;

// Yeni sürüm yayınlandıysa bildirim metni hazırla (Actions Telegram'a gönderir)
if (old) {
  const prev = Object.fromEntries((old.repos || []).map((x) => [x.name, x.release && x.release.tag]));
  const notes = repos.filter((x) => x.release && x.release.tag && prev[x.name] !== x.release.tag)
    .map((x) => `🚀 ${x.name} ${x.release.tag} yayınlandı\n${x.release.url}`);
  if (notes.length) writeFileSync('new-releases.txt', notes.join('\n\n'));
}
if (old && JSON.stringify(old.repos) === JSON.stringify(repos) && JSON.stringify(old.hide || []) === JSON.stringify(cfg.hide || [])) { console.log('Değişiklik yok.'); process.exit(0); }
writeFileSync('data.json', JSON.stringify({ generated: new Date().toISOString(), user: USER, hide: cfg.hide || [], repos }, null, 1));
console.log(`${repos.length} proje yazıldı.`);
