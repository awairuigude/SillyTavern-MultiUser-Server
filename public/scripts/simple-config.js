const SEEN_KEY = 'community.simple-config.seen';

/** Keep a synchronous, per-account receipt if a refresh interrupts settings autosave. */
export function createGuideSeenState(accountStorage, accountHandle) {
    const browserKey = `${SEEN_KEY}:${accountHandle}`;
    let browserSeen = false;
    try {
        browserSeen = globalThis.localStorage.getItem(browserKey) === '1';
    } catch { /* Account storage still works if browser storage is unavailable. */ }
    if (browserSeen && accountStorage.getItem(SEEN_KEY) !== '1') {
        accountStorage.setItem(SEEN_KEY, '1');
    }
    return {
        hasSeen: () => browserSeen || accountStorage.getItem(SEEN_KEY) === '1',
        markSeen() {
            browserSeen = true;
            try {
                globalThis.localStorage.setItem(browserKey, '1');
            } catch { /* Keep saving the account-scoped copy. */ }
            accountStorage.setItem(SEEN_KEY, '1');
        },
    };
}

/** A small account-scoped guide, isolated from imported theme CSS. */
export function initSimpleConfig(accountStorage, accountHandle = 'default-user') {
    if (document.getElementById('community-simple-config')) return;
    const seen = createGuideSeenState(accountStorage, accountHandle);
    const host = document.createElement('div');
    host.id = 'community-simple-config';
    const shadow = host.attachShadow({ mode: 'open' });
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.id = 'simple-config-launcher';
    launcher.textContent = '简单配置';
    launcher.setAttribute('aria-label', '打开简单配置');
    // Keep the entry readable even before the full dialog assets have loaded.
    const entryStyle = document.createElement('style');
    entryStyle.textContent = ':host{all:initial}#simple-config-launcher{position:fixed;right:16px;top:52px;z-index:1100;box-sizing:border-box;border:1px solid #63766a;border-radius:999px;background:#19231e;color:#e1efe5;padding:9px 16px;font:500 13px/1.4 system-ui,sans-serif;cursor:pointer;box-shadow:0 3px 14px #0004}#simple-config-launcher:hover{background:#293b31}#simple-config-launcher:focus-visible{outline:2px solid #bee8cc;outline-offset:3px}';
    shadow.append(entryStyle, launcher);
    document.body.append(host);
    let assets;
    let dialog;
    let locked = false;
    let timer;

    function finish() {
        if (locked) return;
        clearInterval(timer);
        seen.markSeen();
        dialog.close();
        launcher.focus();
    }

    async function open() {
        if (dialog?.open || launcher.disabled) return;
        launcher.disabled = true;
        try {
            assets ??= Promise.all(['/scripts/templates/simple-config.html', '/css/simple-config.css'].map(async url => {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Could not load ${url}`);
                return response.text();
            }));
            const [markup, css] = await assets;
            if (!dialog) {
                const style = document.createElement('style');
                style.textContent = css;
                const template = document.createElement('template');
                template.innerHTML = markup;
                shadow.append(style, template.content.cloneNode(true));
                dialog = shadow.querySelector('dialog');
                dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', finish));
                dialog.addEventListener('cancel', event => {
                    event.preventDefault();
                    finish();
                });
            }
            const first = !seen.hasSeen();
            const deadline = performance.now() + (first ? 5000 : 0);
            const closeButtons = dialog.querySelectorAll('[data-close]');
            const footerButton = dialog.querySelector('#simple-config-done');
            const note = dialog.querySelector('#simple-config-note');
            function update() {
                const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
                locked = remaining > 0;
                closeButtons.forEach(button => { button.disabled = locked; });
                footerButton.textContent = locked ? `${remaining} 秒后关闭` : '关闭';
                note.textContent = '以后可点右上角「简单配置」查看。';
                if (!locked) clearInterval(timer);
            }
            update();
            if (first) timer = setInterval(update, 100);
            dialog.showModal();
            dialog.querySelector('.guide-scroll').scrollTop = 0;
        } catch (error) {
            assets = undefined;
            launcher.textContent = '加载失败，点击重试';
            console.error('Could not open simple configuration', error);
        } finally {
            launcher.disabled = false;
        }
    }
    launcher.addEventListener('click', open);
    if (!seen.hasSeen()) void open();
}
