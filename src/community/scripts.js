/** Add missing default scripts without replacing a user's edits or script data. */
export function mergeDefaultScripts(settings, defaults) {
    const scripts = defaults?.tavern_helper?.script?.scripts;
    if (!Array.isArray(scripts) || !scripts.length) return 0;
    const extensions = settings.extension_settings ??= {};
    const helper = extensions.tavern_helper ??= {};
    const configuration = helper.script ??= {};
    configuration.enabled ??= { global: true, presets: [], characters: [] };
    configuration.popuped ??= { presets: [], characters: [] };
    if (!Array.isArray(configuration.scripts)) configuration.scripts = [];
    const flatten = tree => tree.flatMap(item => item.type === 'folder' ? [item, ...flatten(item.scripts ?? [])] : [item]);
    const existing = flatten(configuration.scripts);
    let added = 0;
    for (const script of scripts) {
        if (existing.some(item => item.id === script.id || (item.type === script.type && item.content === script.content && item.name === script.name))) continue;
        const copy = structuredClone(script);
        configuration.scripts.push(copy);
        existing.push(...flatten([copy]));
        added++;
    }
    return added;
}
