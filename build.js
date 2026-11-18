// Inlines styles and scripts into single self-contained pages:
//   dist/awale.html, dist/bao.html   private preview (premium on)
//   site/index.html, site/bao.html   public Netlify version (premium off)
// plus the rules videos next to them. Usage: node build.js
const fs = require('fs');
const path = require('path');
const root = __dirname;
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

function parts(file) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const between = (a, b) => html.slice(html.indexOf(a) + a.length, html.indexOf(b));
  const head = between('<!-- BUILD:HEAD -->', '<!-- /BUILD:HEAD -->')
    .replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + css + '</style>');
  const body = between('<!-- BUILD:BODY -->', '<!-- /BUILD:BODY -->');
  return { head, body };
}
const inline = (b, premium) => b.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  let js = fs.readFileSync(path.join(root, src), 'utf8');
  if (src === 'src/config.js') js = js.replace('premium: true', 'premium: ' + premium);
  return '<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '</script>';
});
const fullPage = (head, body) => '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  head.trim() + '\n</head>\n<body>\n' + body.trim() + '\n</body>\n</html>\n';

const PAGES = [
  { src: 'index.html', dist: 'awale.html', site: 'index.html' },
  { src: 'bao.html', dist: 'bao.html', site: 'bao.html' },
];
const dist = path.join(root, 'dist'), site = path.join(root, 'site');
fs.mkdirSync(path.join(dist, 'video'), { recursive: true });
fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(path.join(site, 'video'), { recursive: true });
for (const p of PAGES) {
  const { head, body } = parts(p.src);
  // In dist/ the Awale page is awale.html, not the folder index.
  const distBody = inline(body, true).replace(/href="\.\/"/g, 'href="awale.html"');
  fs.writeFileSync(path.join(dist, p.dist), head.trim() + '\n' + distBody.trim() + '\n');
  // Full pages (with doctype) for hosts that serve extra pages as-is, e.g. the claude.ai preview.
  fs.mkdirSync(path.join(dist, 'full'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'full', p.dist), fullPage(head, distBody));
  fs.writeFileSync(path.join(site, p.site), fullPage(head, inline(body, false)));
}
for (const f of fs.readdirSync(path.join(root, 'video'))) {
  if (/^(awale|bao)-rules-[a-z]{2}\.(mp4|jpg)$/.test(f)) {
    fs.copyFileSync(path.join(root, 'video', f), path.join(dist, 'video', f));
    fs.copyFileSync(path.join(root, 'video', f), path.join(site, 'video', f));
  }
}
fs.writeFileSync(path.join(site, '_headers'), '/video/*\n  Cache-Control: public, max-age=604800\n');
console.log('wrote dist/awale.html, dist/bao.html and site/');
