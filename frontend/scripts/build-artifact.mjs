// Convierte dist-artifact/index.html (un solo archivo generado por vite-plugin-singlefile)
// en artifact.html: el formato que acepta un Artifact de claude.ai, que agrega su propio
// <!doctype>/<head>/<body>. Uso: npm run build:artifact
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'dist-artifact', 'index.html'), 'utf8');

const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);
const title = pick(/<title>[\s\S]*?<\/title>/g)[0] ?? '<title>PMBOK Studio</title>';
const fontLinks = pick(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g);
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);

const start = html.indexOf('<script type="module"');
const end = html.indexOf('</script>', start);
if (start < 0 || end < 0) throw new Error('No se encontró el script del bundle');
const script = html.slice(start, end + '</script>'.length).replace(' crossorigin', '');

const out = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  ...fontLinks,
  ...styles,
  '<div id="root"></div>',
  script,
].join('\n');

writeFileSync(join(root, 'artifact.html'), out);
console.log(`artifact.html generado (${(out.length / 1024).toFixed(0)} KB)`);
