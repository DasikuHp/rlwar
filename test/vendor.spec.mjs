// Librerías de animación descargadas (P5, ronda 17 de plan2): cada fichero de public/vendor tiene la huella sha256
// anotada en public/vendor/VENDOR.md, y no hay ficheros sin anotar. Así nada cambia solo. Uso: node test/vendor.spec.mjs
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vendor');
let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const listed = new Map([...readFileSync(join(DIR, 'VENDOR.md'), 'utf8').matchAll(/^([0-9a-f]{64}) (\S+)$/gm)].map((m) => [m[2], m[1]]));
const files = walk(DIR).map((f) => relative(DIR, f).split('\\').join('/')).filter((f) => f !== 'VENDOR.md');

check('VENDOR.md anota las 13 huellas (GSAP ×6, Motion ×2, tsParticles ×2, Lenis ×3)', () => assert.equal(listed.size, 13));
check('cada fichero de public/vendor está anotado', () => assert.deepEqual(files.filter((f) => !listed.has(f)), []));
check('cada fichero anotado existe y su sha256 coincide', () => {
  for (const [f, sha] of listed) assert.equal(createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex'), sha, f);
});
if (fails) { console.log(`\n${fails} fallo(s)`); process.exit(1); }
console.log('\nOK');
