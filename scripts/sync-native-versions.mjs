/**
 * Jedno źródło prawdy: package.json "version" (semver).
 * - iOS: aktualizuje MARKETING_VERSION i CURRENT_PROJECT_VERSION w project.pbxproj
 * - Android: wersja jest wczytywana z package.json przy buildzie (build.gradle)
 *
 * Uruchom: npm run sync-version
 * Przy ręcznym `npm version patch|minor|major` dodaj do komentarza npm: uruchom potem sync lub skorzystaj ze skryptu "version" w package.json.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.0.0').trim();

const base = version.split('-')[0];
const segments = base.split('.');
const major = parseInt(segments[0] || '0', 10) || 0;
const minor = parseInt(segments[1] || '0', 10) || 0;
const patchMatch = String(segments[2] || '0').match(/^(\d+)/);
const patch = patchMatch ? parseInt(patchMatch[1], 10) : 0;
const buildNumber = major * 10000 + minor * 100 + patch;

const pbxPath = join(root, 'ios/App/App.xcodeproj/project.pbxproj');
let pbx = readFileSync(pbxPath, 'utf8');

pbx = pbx.replace(/MARKETING_VERSION = [^;\n]+;/g, `MARKETING_VERSION = ${version};`);
pbx = pbx.replace(
  /CURRENT_PROJECT_VERSION = [^;\n]+;/g,
  `CURRENT_PROJECT_VERSION = ${buildNumber};`
);

writeFileSync(pbxPath, pbx);
console.log(
  `sync-version: iOS MARKETING_VERSION=${version}, CURRENT_PROJECT_VERSION=${buildNumber} (Android: ${version} / code ${buildNumber} z package.json przy gradle)`
);
