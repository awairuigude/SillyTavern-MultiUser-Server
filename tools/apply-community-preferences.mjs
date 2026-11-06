/* eslint-env node */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { applyPreferenceDefaults } from '../src/community/defaults.js';

const dataRoot = path.resolve(process.argv[2] || '.preview-data');
const apply = process.argv.includes('--apply');
const defaults = JSON.parse(await fs.readFile(path.join(dataRoot, '_community/new-user-defaults.json'), 'utf8'));
const users = [];
for (const file of await fs.readdir(path.join(dataRoot, '_storage'))) {
    let user;
    try {
        user = JSON.parse(await fs.readFile(path.join(dataRoot, '_storage', file), 'utf8')).value;
    } catch { continue; }
    if (!user || !/^[a-z0-9][a-z0-9-]*$/.test(user.handle)) continue;
    const root = path.join(dataRoot, user.handle);
    const settingsFile = path.join(root, 'settings.json');
    const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    if (apply) {
        await applyPreferenceDefaults(settings, { root }, defaults);
        writeFileAtomicSync(settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
    }
    users.push({ handle: user.handle, written: apply });
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', users }));
