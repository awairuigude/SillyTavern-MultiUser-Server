import fs from 'node:fs/promises';
import path from 'node:path';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { mergeDefaultScripts } from '../src/community/scripts.js';

const dataRoot = path.resolve(process.argv[2] || '.preview-data');
const apply = process.argv.includes('--apply');
const defaults = JSON.parse(await fs.readFile(path.join(dataRoot, '_community/new-user-defaults.json'), 'utf8'));
const results = [];
for (const file of await fs.readdir(path.join(dataRoot, '_storage'))) {
    let user;
    try {
        user = JSON.parse(await fs.readFile(path.join(dataRoot, '_storage', file), 'utf8')).value;
    } catch { continue; }
    if (!user || typeof user.handle !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(user.handle)) continue;
    const settingsFile = path.join(dataRoot, user.handle, 'settings.json');
    let settings;
    try { settings = JSON.parse(await fs.readFile(settingsFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const added = mergeDefaultScripts(settings, defaults);
    if (apply && added) writeFileAtomicSync(settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
    results.push({ handle: user.handle, added, written: apply && added > 0 });
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', users: results }));
