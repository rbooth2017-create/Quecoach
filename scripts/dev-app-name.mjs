// Dev only: macOS takes the menu-bar app name from the bundle's Info.plist,
// which app.setName() can't change at runtime. Rename the dev copy of
// Electron so `npm run desktop` shows "Cue Coach" instead of "Electron".
// Packaged builds get the name from build.productName and don't need this.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const NAME = 'Cue Coach';

if (process.platform !== 'darwin') process.exit(0);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const plist = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/Info.plist');
if (!existsSync(plist)) process.exit(0);

for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  try {
    execFileSync('plutil', ['-replace', key, '-string', NAME, plist]);
  } catch (err) {
    console.warn(`dev-app-name: couldn't set ${key}: ${err.message}`);
  }
}
console.log(`dev-app-name: Electron dev bundle now named "${NAME}"`);
