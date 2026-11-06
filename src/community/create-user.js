import storage from 'node-persist';
import fs from 'node:fs/promises';
import { toKey, getPasswordHash, getPasswordSalt, getUserDirectories, ensurePublicDirectoriesExist } from '../users.js';
import { checkForNewContent, CONTENT_TYPES } from '../endpoints/content-manager.js';
import { CommunityError } from './store.js';
import { applyNewUserDefaults } from './defaults.js';
import { getConfigValue } from '../util.js';

let pending = Promise.resolve();

/** Shared by invitation registration and the existing admin account creator. */
export async function createUserAccount({ handle, name, password, admin = false }) {
    const previous = pending;
    let release;
    pending = new Promise(resolve => { release = resolve; });
    await previous;
    try {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(handle)) throw new CommunityError(400, 'Invalid handle');
        if (handle === getConfigValue('community.adminLoginAlias', '', 'string')) throw new CommunityError(409, '该用户名已被使用。');
        if (await storage.getItem(toKey(handle))) throw new CommunityError(409, '该用户名已被使用。');
        const directories = getUserDirectories(handle);
        // Deleted accounts may retain data. Never let registration reclaim those files.
        try {
            await fs.stat(directories.root);
            throw new CommunityError(409, '该用户名已有保留数据，请换一个用户名或联系管理员。');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        const salt = getPasswordSalt();
        const user = {
            handle, name, salt, password: password ? getPasswordHash(password, salt) : '',
            admin: !!admin, enabled: true, created: Date.now(),
        };
        // Prepare only the new account's defaults; never copy another user's data or keys.
        await storage.setItem(toKey(handle), user);
        try {
            await ensurePublicDirectoriesExist();
            await checkForNewContent([directories], [CONTENT_TYPES.SETTINGS]);
            await applyNewUserDefaults(directories, name);
        } catch (error) {
            await storage.removeItem(toKey(handle));
            throw error;
        }
        return { handle };
    } finally {
        release();
    }
}
