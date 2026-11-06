import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { importCommunityCharacterFile } from '../endpoints/characters.js';
import { read, write } from '../character-card-parser.js';
import { convertCharacterBook } from './lorebook.js';
import { CommunityError } from './store.js';

let pending = Promise.resolve();

/** Serialize imports to avoid filename collisions and simultaneous settings writes. */
export async function importPublishedCard(store, card, request) {
    const previous = pending;
    let release;
    pending = new Promise(resolve => { release = resolve; });
    await previous;
    const directories = request.user.directories;
    const temporary = path.join(directories.root, `.community-import-${crypto.randomUUID()}.${card.format}`);
    let destination;
    let worldFile;
    try {
        await fs.copyFile(store.cardPaths(card.id, card.format).file, temporary);
        const name = await importCommunityCharacterFile(temporary, card.format, request);
        if (!name) throw new CommunityError(400, '酒馆无法导入这张角色卡。');
        const filename = `${name}.png`;
        destination = path.join(directories.characters, filename);
        const image = await fs.readFile(destination);
        const character = JSON.parse(read(image));
        const data = character.data ?? character;
        let world = null;
        let worldEntries = 0;
        if (Array.isArray(data.character_book?.entries) && data.character_book.entries.length) {
            world = `${sanitize(data.character_book.name || `${data.name}世界书`).slice(0, 60) || '世界书'}-${crypto.randomBytes(4).toString('hex')}`;
            const converted = convertCharacterBook(structuredClone(data.character_book));
            worldEntries = Object.keys(converted.entries).length;
            worldFile = path.join(directories.worlds, `${world}.json`);
            writeFileAtomicSync(worldFile, JSON.stringify(converted), { mode: 0o600 });
            data.extensions ??= {};
            data.extensions.world = world;
        }
        const settingsPath = path.join(directories.root, 'settings.json');
        const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
        const extensions = settings.extension_settings ??= {};
        const regexCount = Array.isArray(data.extensions?.regex_scripts) ? data.extensions.regex_scripts.length : 0;
        if (regexCount) {
            if (!Array.isArray(extensions.character_allowed_regex)) extensions.character_allowed_regex = [];
            if (!extensions.character_allowed_regex.includes(filename)) extensions.character_allowed_regex.push(filename);
        }
        const helperScripts = data.extensions?.tavern_helper?.scripts;
        const hasScripts = Array.isArray(helperScripts) && helperScripts.length > 0;
        if (hasScripts) {
            const helper = extensions.tavern_helper ??= {};
            const script = helper.script ??= {};
            script.enabled ??= { global: true, presets: [], characters: [] };
            script.popuped ??= { presets: [], characters: [] };
            for (const list of [script.enabled, script.popuped]) {
                if (!Array.isArray(list.characters)) list.characters = [];
                if (!list.characters.includes(data.name)) list.characters.push(data.name);
            }
        }
        // Embedded lore/scripts stay in the imported PNG; only its lorebook link changes.
        writeFileAtomicSync(destination, write(image, JSON.stringify(character)));
        writeFileAtomicSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
        return { file_name: name, world, world_entries: worldEntries, regex_scripts: regexCount, helper_scripts_enabled: hasScripts };
    } catch (error) {
        for (const file of [destination, worldFile].filter(Boolean)) {
            await fs.unlink(file).catch(cleanup => console.warn('Could not roll back community import', cleanup.code));
        }
        throw error;
    } finally {
        await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') console.warn('Could not remove community import temporary file', error.code); });
        release();
    }
}
