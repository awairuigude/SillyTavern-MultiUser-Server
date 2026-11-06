const COLLAPSED_KEY = 'community.send-controls.collapsed';

/** Save the account preference and a synchronous receipt for immediate refreshes. */
export function createSendControlsState(accountStorage, accountHandle) {
    const browserKey = `${COLLAPSED_KEY}:${accountHandle}`;
    let stored = accountStorage.getItem(COLLAPSED_KEY);
    try {
        stored = globalThis.localStorage.getItem(browserKey) ?? stored;
    } catch { /* Account storage remains available when browser storage is blocked. */ }
    let collapsed = stored === '1';
    if (stored !== null && accountStorage.getItem(COLLAPSED_KEY) !== stored) {
        accountStorage.setItem(COLLAPSED_KEY, stored);
    }
    return {
        getCollapsed: () => collapsed,
        setCollapsed(value) {
            collapsed = Boolean(value);
            const next = collapsed ? '1' : '0';
            try {
                globalThis.localStorage.setItem(browserKey, next);
            } catch { /* Keep the server-side account preference. */ }
            accountStorage.setItem(COLLAPSED_KEY, next);
        },
    };
}

/** Fold extension button rows without unloading scripts or changing their settings. */
export function initSendControls(accountStorage, accountHandle = 'default-user') {
    const form = document.getElementById('send_form');
    const controls = document.getElementById('rightSendForm');
    if (!form || !controls || document.getElementById('community-toggle-send-controls')) return;
    const state = createSendControlsState(accountStorage, accountHandle);
    const style = document.createElement('style');
    style.textContent = `
        #send_form.community-controls-collapsed > :not(#nonQRFormItems):not(#file_form) {
            display: none !important;
        }
        #rightSendForm > #community-toggle-send-controls {
            order: -1; align-self: center; flex: 0 0 44px;
            width: 44px; min-width: 44px; height: var(--bottomFormBlockSize, 32px);
            margin: 0; padding: 0 3px; border: 0; border-radius: 5px;
            background: transparent; color: var(--SmartThemeBodyColor, #ddd);
            font: 12px/1.2 system-ui, sans-serif; white-space: nowrap;
            cursor: pointer; opacity: .8;
        }
        #rightSendForm > #community-toggle-send-controls:hover { opacity: 1; background: #8882; }
        #community-toggle-send-controls:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
    `;
    document.head.append(style);
    const button = document.createElement('button');
    button.id = 'community-toggle-send-controls';
    button.type = 'button';
    function render() {
        const collapsed = state.getCollapsed();
        form.classList.toggle('community-controls-collapsed', collapsed);
        button.textContent = collapsed ? '▴ 展开' : '▾ 收起';
        button.title = collapsed ? '展开按钮栏' : '收起按钮栏';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-expanded', String(!collapsed));
    }
    button.addEventListener('click', () => {
        state.setCollapsed(!state.getCollapsed());
        render();
    });
    controls.prepend(button);
    render();
}
