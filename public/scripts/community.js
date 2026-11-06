const $ = selector => document.querySelector(selector);
let cards = [];
let admin = false;
let contentMode = 'sfw';
let selectedCategory = 'all';
const imported = new Set();
const importing = new Set();
let noticeTimer;
let noticeAction;
let reorderMode = false;
let draggedCardId = null;
let draggedCardRating = null;
let dropMarker;
let dropPlacement;
let savedView;

function notify(message, error = false) {
    $('#status').textContent = message;
    $('#status').classList.toggle('error', error);
}

async function api(url, options = {}) {
    const response = await fetch(`/api/community${url}`, options);
    if (response.status === 403) {
        const me = await fetch('/api/users/me');
        if (me.status === 403 || me.redirected) window.location.assign('/login');
    }
    if (response.status === 204) return null;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '操作未完成，请重试。');
    return data;
}

async function post(url, body) {
    const { token } = await (await fetch('/csrf-token')).json();
    return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(body) });
}

async function patch(url, body) {
    const { token } = await (await fetch('/csrf-token')).json();
    return api(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(body) });
}

async function remove(url) {
    const { token } = await (await fetch('/csrf-token')).json();
    return api(url, { method: 'DELETE', headers: { 'X-CSRF-Token': token } });
}

function tagSpan(text) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = text;
    return tag;
}

function setManage(open) {
    if (!admin) return;
    const dialog = $('#manage');
    if (open) {
        if (!dialog.open) dialog.showModal();
        loadInvites().catch(error => notify(error.message, true));
    } else if (dialog.open) {
        dialog.close();
    }
}

function cardMatchesMode(card) {
    return contentMode === 'nsfw' || card.rating === 'sfw';
}

function cardMatchesCategory(card) {
    return selectedCategory === 'all' || card.rating === selectedCategory;
}

function cardOrder(card, rating = card.rating) {
    return Number(card.sortOrderByRating?.[rating] ?? card.sortOrder ?? 100000);
}

function curatedCompare(a, b) {
    if (contentMode === 'nsfw' && selectedCategory === 'all' && a.rating !== b.rating) return a.rating === 'sfw' ? -1 : 1;
    return cardOrder(a) - cardOrder(b) || b.created - a.created;
}

function reorderRatings() {
    if (selectedCategory !== 'all') return [selectedCategory];
    return contentMode === 'sfw' ? ['sfw'] : ['sfw', 'nsfw'];
}

function publishedIdsFromGallery(rating) {
    const byId = new Map(cards.map(card => [card.id, card]));
    return [...$('#gallery').children]
        .map(element => element.dataset.cardId)
        .filter(id => byId.get(id)?.published && (!rating || byId.get(id).rating === rating));
}

function clearDropMarker() {
    dropMarker?.remove();
    dropMarker = null;
    dropPlacement = null;
}

function startReorder() {
    if (!admin || reorderMode) return;
    savedView = { contentMode, selectedCategory, search: $('#search').value, sort: $('#sort').value };
    reorderMode = true;
    $('#search').value = '';
    $('#sort').value = 'curated';
    document.body.classList.add('reorder-mode');
    $('#reorderDone').hidden = false;
    setManage(false);
    renderFilters();
    renderCards();
    notify(`当前排序分类：${reorderRatings().map(rating => rating.toUpperCase()).join('、')}。拖到卡片之间，完成后保存。`);
}

async function finishReorder() {
    if (!reorderMode) return;
    const button = $('#reorderDone');
    button.disabled = true;
    try {
        const ratings = reorderRatings();
        const payload = ratings.length === 1
            ? { rating: ratings[0], orderedIds: publishedIdsFromGallery(ratings[0]) }
            : { orderedIdsByRating: Object.fromEntries(ratings.map(rating => [rating, publishedIdsFromGallery(rating)])) };
        await patch('/cards/reorder', payload);
        const view = savedView;
        reorderMode = false;
        draggedCardId = null;
        draggedCardRating = null;
        clearDropMarker();
        document.body.classList.remove('reorder-mode');
        button.hidden = true;
        if (view) {
            contentMode = view.contentMode;
            selectedCategory = view.selectedCategory;
            $('#search').value = view.search;
            $('#sort').value = view.sort;
        }
        await loadCards();
        notify('角色卡顺序已保存。');
    } catch (error) {
        notify(error.message, true);
    } finally {
        button.disabled = false;
    }
}

function reorderCardsLocally(sourceId, targetId, before, rating) {
    const ordered = cards.filter(card => card.published && card.rating === rating).sort((a, b) => cardOrder(a, rating) - cardOrder(b, rating) || b.created - a.created);
    const base = cardOrder(ordered[0], rating);
    const sourceIndex = ordered.findIndex(card => card.id === sourceId);
    const targetIndex = ordered.findIndex(card => card.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const [source] = ordered.splice(sourceIndex, 1);
    const targetAfterRemoval = ordered.findIndex(card => card.id === targetId);
    ordered.splice(targetAfterRemoval + (before ? 0 : 1), 0, source);
    const start = base > 0 && base < 100000 ? base : 10;
    ordered.forEach((card, index) => {
        card.sortOrderByRating ||= {};
        card.sortOrderByRating[rating] = start + index * 10;
        if (card.rating === rating) card.sortOrder = start + index * 10;
    });
    draggedCardId = null;
    draggedCardRating = null;
    clearDropMarker();
    renderCards();
    notify('顺序已调整，点击“保存排序”写入服务器。');
}

function showDropMarker(element, before, rating) {
    if (!dropMarker) {
        dropMarker = document.createElement('div');
        dropMarker.className = 'drop-marker';
        dropMarker.textContent = '放在这里';
        dropMarker.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
        dropMarker.addEventListener('drop', event => {
            event.preventDefault();
            if (dropPlacement) reorderCardsLocally(draggedCardId, dropPlacement.targetId, dropPlacement.before, dropPlacement.rating);
        });
    }
    dropPlacement = { targetId: element.dataset.cardId, before, rating };
    if (before) element.before(dropMarker);
    else element.after(dropMarker);
}

function configureReorder(element, card) {
    element.dataset.cardId = card.id;
    element.dataset.rating = card.rating;
    element.draggable = reorderMode && card.published;
    if (!element.draggable) return;
    element.classList.add('is-draggable');
    element.addEventListener('dragstart', event => {
        draggedCardId = card.id;
        draggedCardRating = card.rating;
        element.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', card.id);
    });
    element.addEventListener('dragend', () => {
        draggedCardId = null;
        draggedCardRating = null;
        element.classList.remove('is-dragging');
        clearDropMarker();
    });
    element.addEventListener('dragover', event => {
        if (!draggedCardId || draggedCardId === card.id || !card.published) return;
        event.preventDefault();
        if (draggedCardRating !== card.rating) {
            clearDropMarker();
            return;
        }
        event.dataTransfer.dropEffect = 'move';
        showDropMarker(element, event.clientY < element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2, card.rating);
    });
    element.addEventListener('drop', event => {
        event.preventDefault();
        if (draggedCardRating !== card.rating) return;
        const before = event.clientY < element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2;
        reorderCardsLocally(draggedCardId, card.id, before, card.rating);
    });
}

async function loadCards() {
    const data = await api('/cards');
    cards = data.cards;
    admin = data.admin;
    $('#currentAccount').textContent = data.name || data.handle;
    $('#manageToggle').hidden = !admin;
    $('#cardCount').textContent = `${cards.filter(card => card.published).length} 张角色卡`;
    renderFilters();
    renderCards();
}

function renderFilters() {
    const filters = $('#tagFilters');
    filters.replaceChildren();
    const categories = contentMode === 'nsfw'
        ? [['all', '全部角色'], ['sfw', 'SFW'], ['nsfw', 'NSFW']]
        : [['all', '全部角色']];
    if (!categories.some(([key]) => key === selectedCategory)) selectedCategory = 'all';
    for (const [key, label] of categories) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tag-filter';
        button.textContent = label;
        button.setAttribute('aria-pressed', String(selectedCategory === key));
        button.addEventListener('click', () => { selectedCategory = key; renderFilters(); renderCards(); });
        filters.append(button);
    }
    const toggle = $('#contentModeToggle');
    toggle.textContent = contentMode === 'sfw' ? 'NSFW' : 'SFW';
    toggle.setAttribute('aria-pressed', String(contentMode === 'nsfw'));
    toggle.title = contentMode === 'sfw' ? '打开 NSFW 角色' : '只看 SFW 角色';
}

function renderCards() {
    const search = $('#search').value.trim().toLocaleLowerCase();
    const visible = cards.filter(card => (card.published || admin) && cardMatchesMode(card) && cardMatchesCategory(card) &&
        `${card.name} ${card.description} ${card.detail} ${card.creator} ${card.tags.join(' ')}`.toLocaleLowerCase().includes(search));
    if ($('#sort').value === 'name') visible.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    else if ($('#sort').value === 'newest') visible.sort((a, b) => b.created - a.created);
    else visible.sort(curatedCompare);
    const gallery = $('#gallery');
    gallery.replaceChildren();
    for (const card of visible) {
        const element = $('#cardTemplate').content.firstElementChild.cloneNode(true);
        configureReorder(element, card);
        element.querySelector('.card-name').textContent = card.name;
        element.querySelector('.card-description').textContent = card.description || '暂未填写广场简介。';
        element.querySelector('.card-byline').textContent = `${card.creator || '角色卡'} · ${new Date(card.created).toLocaleDateString('zh-CN')}`;
        const coverButton = element.querySelector('.cover-button');
        coverButton.setAttribute('aria-label', `查看 ${card.name} 的详情`);
        if (card.hasCover) {
            const image = element.querySelector('.card-cover');
            image.hidden = false;
            image.src = `/api/community/cards/${card.id}/cover`;
            image.addEventListener('error', () => { image.hidden = true; });
        }
        element.querySelector('.card-state').hidden = card.published;
        element.querySelector('.card-tags').append(tagSpan(card.rating.toUpperCase()));
        for (const tag of card.tags.slice(0, 3)) element.querySelector('.card-tags').append(tagSpan(tag));
        coverButton.addEventListener('click', () => showDetail(card));
        configureImport(element.querySelector('.import-button'), card);
        const noticeButton = element.querySelector('.notice-button');
        noticeButton.hidden = !card.importNotice;
        noticeButton.textContent = card.importNotice?.mode === 'required' ? '务必配置' : '推荐配置';
        noticeButton.addEventListener('click', () => showNotice(card));
        const toggle = element.querySelector('.publish-toggle');
        toggle.hidden = !admin;
        toggle.textContent = card.published ? '下架角色卡' : '重新上架';
        toggle.addEventListener('click', async () => {
            toggle.disabled = true;
            try {
                await post(`/cards/${card.id}/publish`, { published: !card.published });
                notify(card.published ? '已下架。已导入的副本会继续保留。' : '角色卡已重新上架。');
                await loadCards();
            } catch (error) { notify(error.message, true); toggle.disabled = false; }
        });
        const edit = element.querySelector('.edit-card-button');
        edit.hidden = !admin;
        edit.addEventListener('click', () => showDetail(card, true));
        const removeButton = element.querySelector('.delete-card-button');
        removeButton.hidden = !admin;
        removeButton.addEventListener('click', async () => {
            if (!window.confirm(`确定删除“${card.name}”？删除后无法从角色广场恢复，已导入用户的副本不受影响。`)) return;
            removeButton.disabled = true;
            try {
                await remove(`/cards/${card.id}`);
                await loadCards();
                notify(`「${card.name}」已删除。`);
            } catch (error) {
                notify(error.message, true);
                removeButton.disabled = false;
            }
        });
        gallery.append(element);
    }
    const filtered = !reorderMode && (!!search || selectedCategory !== 'all' || contentMode === 'sfw');
    $('#emptyState').hidden = visible.length > 0;
    $('#emptyTitle').textContent = filtered ? '没有找到匹配的角色' : '广场还没有角色卡';
    $('#emptyDescription').textContent = filtered ? '试试其他关键词，或切换分类。' : admin ? '把你准备好的角色卡上架，邀请朋友一起探索。' : '管理员上架角色后，你就可以在这里发现并导入。';
    $('#emptyPublish').hidden = reorderMode || !admin || filtered;
}

function configureImport(button, card) {
    button.textContent = imported.has(card.id) ? '已导入 ✓' : importing.has(card.id) ? '正在导入…' : '导入我的酒馆 ＋';
    button.disabled = imported.has(card.id) || importing.has(card.id);
    button.addEventListener('click', () => showNotice(card, true));
}

function showDetail(card, editMode = false) {
    const content = $('#detailContent');
    content.replaceChildren();
    if (!editMode) {
        const name = document.createElement('h2'); name.textContent = card.name;
        const byline = document.createElement('p'); byline.className = 'muted';
        byline.textContent = `${card.creator || '角色卡'} · ${(card.bytes / 1024).toFixed(0)} KiB · ${card.format.toUpperCase()} · ${card.rating.toUpperCase()}`;
        const tags = document.createElement('div'); tags.className = 'card-tags';
        for (const tag of [card.rating.toUpperCase(), ...card.tags]) tags.append(tagSpan(tag));
        const description = document.createElement('p'); description.className = 'detail-description';
        description.textContent = card.description || '这个角色还没有广场简介。';
        const detail = document.createElement('p'); detail.className = 'detail-long'; detail.textContent = card.detail || ''; detail.hidden = !card.detail;
        const note = document.createElement('p'); note.className = 'detail-note'; note.textContent = '导入后会在你的账户中创建独立副本，不会覆盖已有角色或聊天。';
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button primary'; button.textContent = '导入我的酒馆 ＋';
        button.disabled = imported.has(card.id); button.addEventListener('click', () => showNotice(card, true));
        content.append(name, byline, tags, description, detail, note, button);
        if (card.importNotice) {
            const notice = document.createElement('button'); notice.type = 'button'; notice.className = 'button secondary detail-notice-button';
            notice.textContent = card.importNotice.mode === 'required' ? '查看务必配置' : '查看推荐配置'; notice.addEventListener('click', () => showNotice(card)); content.append(notice);
        }
    } else {
        const heading = document.createElement('h2'); heading.textContent = `编辑：${card.name}`;
        const form = document.createElement('form'); form.className = 'stack-form admin-card-edit';
        form.innerHTML = '<label>标题<input name="name" maxlength="100"></label><label>广场简介<textarea name="description" maxlength="600" rows="3"></textarea></label><label>详情介绍<textarea name="detail" maxlength="12000" rows="6"></textarea></label><div class="form-row"><label>分类<select name="rating"><option value="sfw">SFW</option><option value="nsfw">NSFW</option></select></label><label>排序号 <span class="muted">越小越靠前</span><input name="sortOrder" type="number" min="0"></label></div><label>导入注意事项<textarea name="notice" maxlength="2000" rows="4" placeholder="留空则移除注意事项"></textarea></label><label>注意事项类型<select name="noticeMode"><option value="recommended">推荐配置</option><option value="required">务必配置</option></select></label><button class="button primary" type="submit">保存卡片信息</button>';
        form.elements.name.value = card.name; form.elements.description.value = card.description; form.elements.detail.value = card.detail; form.elements.rating.value = card.rating; form.elements.sortOrder.value = card.sortOrder; form.elements.notice.value = card.importNotice?.text || ''; form.elements.noticeMode.value = card.importNotice?.mode || 'recommended';
        form.addEventListener('submit', async event => {
            event.preventDefault(); const value = event.currentTarget.elements; const button = event.submitter; button.disabled = true;
            try { await patch(`/cards/${card.id}`, { name: value.name.value, description: value.description.value, detail: value.detail.value, rating: value.rating.value, sortOrder: Number(value.sortOrder.value), importNotice: value.notice.value.trim() ? { mode: value.noticeMode.value, text: value.notice.value } : null }); $('#cardDetail').close(); await loadCards(); notify('角色卡信息已更新。'); }
            catch (error) { notify(error.message, true); button.disabled = false; }
        });
        content.append(heading, form);
    }
    $('#cardDetail').showModal();
}

function showNotice(card, thenImport = false) {
    if (!card.importNotice) return thenImport ? importCard(card) : undefined;
    noticeAction = thenImport ? () => importCard(card) : null;
    $('#importNoticeTitle').textContent = card.importNotice.mode === 'required' ? '务必配置' : '推荐配置';
    $('#importNoticeText').textContent = card.importNotice.text;
    const confirm = $('#confirmImport'); const countdown = $('#importNoticeCountdown');
    confirm.disabled = true; let remaining = 3; countdown.textContent = `${remaining} 秒后可继续`;
    clearInterval(noticeTimer);
    noticeTimer = setInterval(() => { remaining -= 1; countdown.textContent = remaining > 0 ? `${remaining} 秒后可继续` : '可以继续'; confirm.disabled = remaining > 0; if (remaining <= 0) clearInterval(noticeTimer); }, 1000);
    $('#importNoticeDialog').showModal();
}

$('#confirmImport').addEventListener('click', () => { const action = noticeAction; noticeAction = null; $('#importNoticeDialog').close(); action?.(); });
$('#cancelImport').addEventListener('click', () => { noticeAction = null; $('#importNoticeDialog').close(); });

async function importCard(card) {
    if (importing.has(card.id) || imported.has(card.id)) return;
    importing.add(card.id); renderCards();
    try { const result = await post(`/cards/${card.id}/import`, {}); if (result.error || !result.file_name) throw new Error('角色卡无法被酒馆导入，请联系管理员检查文件。'); imported.add(card.id); notify(`「${card.name}」已导入：${result.world_entries} 条世界书、${result.regex_scripts} 条正则。`); }
    catch (error) { notify(error.message, true); } finally { importing.delete(card.id); renderCards(); }
}

async function loadInvites() {
    const invites = await api('/invites'); const list = $('#inviteList'); list.replaceChildren();
    const statuses = { available: '可使用', used: '已使用', expired: '已过期', revoked: '已作废' };
    for (const invite of invites) {
        const item = document.createElement('li'); const meta = document.createElement('div'); meta.className = 'invite-meta';
        const label = document.createElement('span'); label.textContent = `${invite.hint} · ${statuses[invite.status]}`;
        const info = document.createElement('small'); info.textContent = invite.usedBy ? `注册用户：${invite.usedBy}` : `到期：${new Date(invite.expires).toLocaleString('zh-CN')}`;
        meta.append(label, info); item.append(meta);
        if (invite.status === 'available') { const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = '作废'; button.addEventListener('click', async () => { try { await post(`/invites/${invite.id}/revoke`, {}); await loadInvites(); } catch (error) { notify(error.message, true); } }); item.append(button); }
        list.append(item);
    }
}

$('#inviteForm').addEventListener('submit', async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const invite = await post('/invites', { days: Number(event.currentTarget.elements.days.value) }); $('#inviteCode').value = invite.code; $('#newInvite').hidden = false; await loadInvites(); notify('邀请码已生成，请复制后发给朋友。'); } catch (error) { notify(error.message, true); } finally { button.disabled = false; } });
$('#copyInvite').addEventListener('click', async () => { const input = $('#inviteCode'); try { await navigator.clipboard.writeText(input.value); $('#copyInvite').textContent = '已复制'; setTimeout(() => { $('#copyInvite').textContent = '复制'; }, 1500); } catch { input.focus(); input.select(); notify('请复制选中的邀请码。'); } });

$('#publishForm').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const button = event.submitter; button.disabled = true; notify('正在上架角色卡…'); try { const { token } = await (await fetch('/csrf-token')).json(); await api('/cards', { method: 'POST', headers: { 'X-CSRF-Token': token }, body: new FormData(form) }); form.reset(); await loadCards(); notify('角色卡已上架。'); } catch (error) { notify(error.message, true); } finally { button.disabled = false; } });
$('#manageToggle').addEventListener('click', () => setManage(true));
$('#closeManage').addEventListener('click', () => setManage(false));
$('#manage').addEventListener('click', event => { if (event.target === $('#manage')) setManage(false); });
$('#reorderToggle').addEventListener('click', startReorder);
$('#reorderDone').addEventListener('click', finishReorder);
$('#contentModeToggle').addEventListener('click', () => { contentMode = contentMode === 'sfw' ? 'nsfw' : 'sfw'; selectedCategory = 'all'; renderFilters(); renderCards(); });
$('#emptyPublish').addEventListener('click', () => { setManage(true); $('#publishForm input[type="file"]').focus(); });
$('#search').addEventListener('input', renderCards); $('#sort').addEventListener('change', renderCards);
$('#closeDetail').addEventListener('click', () => $('#cardDetail').close()); $('#cardDetail').addEventListener('click', event => { if (event.target === $('#cardDetail')) $('#cardDetail').close(); });

let lastScrollY = window.scrollY;
window.addEventListener('scroll', () => {
    const current = window.scrollY;
    const hero = document.querySelector('.hero');
    if (current <= 8 || current < lastScrollY) hero.classList.remove('hero-collapsed');
    else if (current > lastScrollY) hero.classList.add('hero-collapsed');
    lastScrollY = current;
}, { passive: true });

try { await loadCards(); notify(''); } catch (error) { notify(error.message, true); $('#cardCount').textContent = '加载未完成'; }
