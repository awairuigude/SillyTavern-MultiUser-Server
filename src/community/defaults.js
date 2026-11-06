import fs from 'node:fs/promises';
import path from 'node:path';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import sanitize from 'sanitize-filename';

/** Install independent theme copies and the requested default layout. */
export async function applyInterfaceDefaults(settings, directories, defaults) {
    if (defaults.interfaceDefaults) {
        settings.power_user ??= {};
        Object.assign(settings.power_user, structuredClone(defaults.interfaceDefaults));
    }
    const themeDirectory = directories.themes ?? path.join(directories.root, 'themes');
    for (const theme of defaults.uiThemes ?? []) {
        const name = sanitize(theme.name);
        if (!name) throw new Error('Invalid bundled theme name');
        await fs.mkdir(themeDirectory, { recursive: true });
        try {
            await fs.writeFile(path.join(themeDirectory, `${name}.json`), JSON.stringify(theme, null, 2), { flag: 'wx', mode: 0o600 });
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
    }
}

/** Apply the prepared interface/preset defaults without copying identities or connections. */
export async function applyPreferenceDefaults(settings, directories, defaults) {
    const preferences = defaults.preferences;
    if (!preferences) return;
    if (preferences.main_api !== 'openai' || !defaults.chatCompletionPreset?.name) throw new Error('Invalid community preference defaults');
    const name = defaults.chatCompletionPreset.name;
    if (/[\\/\x00]/.test(name) || name === '.' || name === '..') throw new Error('Invalid default preset name');
    settings.main_api = 'openai';
    settings.power_user ??= {};
    const { stscript, ...ui } = preferences.power_user;
    Object.assign(settings.power_user, structuredClone(ui));
    if (stscript) {
        settings.power_user.stscript ??= {};
        settings.power_user.stscript.parser = structuredClone(stscript.parser);
    }
    settings.oai_settings ??= {};
    Object.assign(settings.oai_settings, structuredClone(preferences.oai_settings));
    settings.accountStorage ??= {};
    Object.assign(settings.accountStorage, structuredClone(preferences.accountStorage));
    const extensions = settings.extension_settings ??= {};
    const helper = extensions.tavern_helper ??= {};
    helper.script ??= {};
    helper.script.enabled ??= {};
    helper.script.enabled.presets ??= [];
    if (!helper.script.enabled.presets.includes(name)) helper.script.enabled.presets.push(name);
    helper.script.popuped ??= {};
    helper.script.popuped.presets ??= [];
    if (!helper.script.popuped.presets.includes(name)) helper.script.popuped.presets.push(name);
    extensions.preset_allowed_regex ??= {};
    extensions.preset_allowed_regex.openai ??= [];
    if (!extensions.preset_allowed_regex.openai.includes(name)) extensions.preset_allowed_regex.openai.push(name);
    const presetDirectory = directories.openAI_Settings ?? path.join(directories.root, 'OpenAI Settings');
    await fs.mkdir(presetDirectory, { recursive: true });
    writeFileAtomicSync(path.join(presetDirectory, `${name}.json`), JSON.stringify(defaults.chatCompletionPreset, null, 2), { mode: 0o600 });
    if (defaults.presetWorldbook) {
        const worldDirectory = directories.worlds ?? path.join(directories.root, 'worlds');
        await fs.mkdir(worldDirectory, { recursive: true });
        const worldFile = path.join(worldDirectory, '剑仙RE规则书.json');
        try {
            await fs.writeFile(worldFile, JSON.stringify(defaults.presetWorldbook), { flag: 'wx', mode: 0o600 });
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
    }
}

/** Only explicitly prepared plugin defaults are inherited, never a user's full settings. */
export async function applyNewUserDefaults(directories, name) {
    let defaults;
    try {
        defaults = JSON.parse(await fs.readFile(path.join(globalThis.DATA_ROOT, '_community', 'new-user-defaults.json'), 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }
    const settingsFile = path.join(directories.root, 'settings.json');
    const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    settings.username = name;
    settings.extension_settings ??= {};
    for (const key of ['tavern_helper', 'EjsTemplate', 'disabledExtensions', 'manual_saver']) {
        if (Object.hasOwn(defaults, key)) settings.extension_settings[key] = structuredClone(defaults[key]);
    }
    await applyPreferenceDefaults(settings, directories, defaults);
    await applyInterfaceDefaults(settings, directories, defaults);
    writeFileAtomicSync(settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
}
