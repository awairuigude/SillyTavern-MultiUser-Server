import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

export class CommunityError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const digest = code => crypto.createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex');
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const cardRating = value => value === 'sfw' ? 'sfw' : 'nsfw';
const cardText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const ORDER_RATINGS = ['sfw', 'nsfw'];

function numericOrder(value) {
    return Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

function orderFor(card, rating = cardRating(card.rating)) {
    const categoryOrder = card.sortOrderByRating && typeof card.sortOrderByRating === 'object'
        ? numericOrder(card.sortOrderByRating[rating])
        : null;
    return categoryOrder ?? numericOrder(card.sortOrder) ?? 100000;
}

function ensureCategoryOrders(card) {
    const current = card.sortOrderByRating && typeof card.sortOrderByRating === 'object' ? card.sortOrderByRating : {};
    card.sortOrderByRating = {
        sfw: numericOrder(current.sfw) ?? numericOrder(card.sortOrder) ?? 100000,
        nsfw: numericOrder(current.nsfw) ?? numericOrder(card.sortOrder) ?? 100000,
    };
    return card.sortOrderByRating;
}

function normalizeCard(card) {
    const notice = card.importNotice && typeof card.importNotice === 'object'
        ? { mode: card.importNotice.mode === 'required' ? 'required' : 'recommended', text: cardText(card.importNotice.text, 2000) }
        : null;
    const sortOrderByRating = ensureCategoryOrders({ ...card });
    return {
        ...card,
        description: cardText(card.description, 600),
        detail: cardText(card.detail, 12000),
        tags: Array.isArray(card.tags) ? card.tags.filter(tag => typeof tag === 'string').slice(0, 12) : [],
        rating: cardRating(card.rating),
        sortOrder: orderFor(card),
        sortOrderByRating,
        importNotice: notice?.text ? notice : null,
    };
}

function cardSort(a, b) {
    const ratingDifference = ORDER_RATINGS.indexOf(cardRating(a.rating)) - ORDER_RATINGS.indexOf(cardRating(b.rating));
    return ratingDifference || orderFor(a) - orderFor(b) || Number(b.created ?? 0) - Number(a.created ?? 0);
}

function publishedCards(state, rating = null) {
    return state.cards
        .filter(card => card.published && (!rating || cardRating(card.rating) === rating))
        .sort((a, b) => orderFor(a, rating || cardRating(a.rating)) - orderFor(b, rating || cardRating(b.rating)) || Number(b.created ?? 0) - Number(a.created ?? 0));
}

function hydrateCategoryOrders(state) {
    for (const rating of ORDER_RATINGS) {
        const group = state.cards
            .filter(card => card.published && cardRating(card.rating) === rating)
            .sort((a, b) => Number(a.sortOrder ?? 100000) - Number(b.sortOrder ?? 100000) || Number(b.created ?? 0) - Number(a.created ?? 0));
        if (!group.length) continue;
        const hasCategoryOrders = group.some(card => numericOrder(card.sortOrderByRating?.[rating]) !== null);
        if (!hasCategoryOrders) {
            group.forEach((card, index) => {
                ensureCategoryOrders(card)[rating] = (index + 1) * 10;
                card.sortOrder = (index + 1) * 10;
            });
        } else {
            let next = group.reduce((value, card) => Math.max(value, orderFor(card, rating)), 0) + 10;
            for (const card of group) {
                const orders = ensureCategoryOrders(card);
                if (numericOrder(orders[rating]) === null) orders[rating] = next += 10;
                card.sortOrder = orders[rating];
            }
        }
    }
}

function orderBase(cards, rating = null) {
    const first = Number(cards[0] ? orderFor(cards[0], rating || cardRating(cards[0].rating)) : NaN);
    return Number.isInteger(first) && first > 0 ? first : 10;
}

function renumberPublished(state, rating, orderedIds = null, base = null) {
    const current = publishedCards(state, rating);
    let ordered = current;
    const start = base ?? orderBase(current, rating);
    if (orderedIds) {
        const byId = new Map(current.map(card => [card.id, card]));
        if (orderedIds.length !== current.length || orderedIds.some(id => !byId.has(id)) || new Set(orderedIds).size !== orderedIds.length) {
            throw new CommunityError(400, '排序列表与当前已上架角色卡不一致，请刷新后重试。');
        }
        ordered = orderedIds.map(id => byId.get(id));
    }
    ordered.forEach((card, index) => {
        ensureCategoryOrders(card)[rating] = start + index * 10;
        if (cardRating(card.rating) === rating) card.sortOrder = start + index * 10;
    });
    return ordered;
}

/** A single-process store; serialize mutations before atomically replacing the index. */
export class CommunityStore {
    #pending = Promise.resolve();

    constructor(directory) {
        this.directory = path.resolve(directory);
        this.index = path.join(this.directory, 'index.json');
    }

    async locked(callback) {
        const previous = this.#pending;
        let release;
        this.#pending = new Promise(resolve => { release = resolve; });
        await previous;
        try {
            await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
            let state;
            try {
                state = JSON.parse(await fs.readFile(this.index, 'utf8'));
                if (state.version !== 1 || !Array.isArray(state.invites) || !Array.isArray(state.cards)) {
                    throw new Error('Unsupported community index');
                }
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                state = { version: 1, invites: [], cards: [] };
            }
            return await callback(state);
        } finally {
            release();
        }
    }

    save(state) {
        writeFileAtomicSync(this.index, JSON.stringify(state, null, 2), { mode: 0o600 });
    }

    async createInvite(days = 7) {
        if (!Number.isInteger(days) || days < 1 || days > 30) throw new CommunityError(400, '有效期应为 1～30 天。');
        return this.locked(state => {
            if (state.invites.filter(item => !item.revoked && !item.usedBy && item.expires > Date.now()).length >= 100) {
                throw new CommunityError(400, '未使用的邀请码已达到 100 个，请先作废不需要的邀请码。');
            }
            const secret = crypto.randomBytes(12).toString('hex').toUpperCase();
            const code = `ST-${secret.match(/.{4}/g).join('-')}`;
            const invite = {
                id: crypto.randomUUID(), hash: digest(code), hint: `ST-…-${secret.slice(-4)}`,
                created: Date.now(), expires: Date.now() + days * 86400000, usedBy: null, revoked: false,
            };
            state.invites.push(invite);
            this.save(state);
            return { ...this.inviteView(invite), code };
        });
    }

    inviteView(invite) {
        const view = { ...invite };
        delete view.hash;
        return { ...view, status: invite.revoked ? 'revoked' : invite.usedBy ? 'used' : invite.expires <= Date.now() ? 'expired' : 'available' };
    }

    async listInvites() {
        return this.locked(state => state.invites.map(item => this.inviteView(item)).reverse());
    }

    async revokeInvite(id) {
        if (!validId(id)) throw new CommunityError(404, '邀请码不存在。');
        return this.locked(state => {
            const invite = state.invites.find(item => item.id === id);
            if (!invite) throw new CommunityError(404, '邀请码不存在。');
            invite.revoked = true;
            this.save(state);
        });
    }

    async register(code, handle, createUser) {
        if (typeof code !== 'string' || code.length > 100) throw new CommunityError(400, '邀请码无效、已使用或已过期。');
        return this.locked(async state => {
            const invite = state.invites.find(item => item.hash === digest(code));
            if (!invite || invite.revoked || invite.usedBy || invite.expires <= Date.now()) {
                throw new CommunityError(400, '邀请码无效、已使用或已过期。');
            }
            // Reserve durably first. A crash can consume a code, but cannot redeem it twice.
            invite.usedBy = handle;
            invite.usedAt = Date.now();
            this.save(state);
            try {
                return await createUser();
            } catch (error) {
                invite.usedBy = null;
                delete invite.usedAt;
                this.save(state);
                throw error;
            }
        });
    }

    cardPaths(id, format) {
        if (!validId(id) || !['png', 'json'].includes(format)) throw new CommunityError(404, '角色卡不存在。');
        return {
            file: path.join(this.directory, `${id}.${format}`),
            cover: path.join(this.directory, `${id}.cover.png`),
        };
    }

    async publishCard(metadata, buffer, cover) {
        return this.locked(async state => {
            hydrateCategoryOrders(state);
            const rating = cardRating(metadata.rating);
            const requestedOrder = Number.isInteger(metadata.sortOrder) && metadata.sortOrder >= 0 ? metadata.sortOrder : null;
            const nextOrder = publishedCards(state, rating).reduce((max, card) => Math.max(max, orderFor(card, rating)), 0) + 10;
            const sortOrder = requestedOrder ?? nextOrder;
            const card = normalizeCard({ ...metadata, rating, sortOrder, sortOrderByRating: { [rating]: sortOrder }, id: crypto.randomUUID(), published: true, created: Date.now() });
            const paths = this.cardPaths(card.id, card.format);
            await fs.writeFile(paths.file, buffer, { flag: 'wx', mode: 0o600 });
            try {
                if (cover) await fs.writeFile(paths.cover, cover, { flag: 'wx', mode: 0o600 });
                card.hasCover = !!cover;
                state.cards.push(card);
                this.save(state);
            } catch (error) {
                await Promise.allSettled([fs.unlink(paths.file), fs.unlink(paths.cover)]);
                throw error;
            }
            return card;
        });
    }

    async listCards(admin = false) {
        return this.locked(state => {
            hydrateCategoryOrders(state);
            return state.cards
                .filter(card => admin || card.published)
                .map(normalizeCard)
                .sort(cardSort);
        });
    }

    async getCard(id, admin = false) {
        if (!validId(id)) throw new CommunityError(404, '角色卡不存在。');
        return this.locked(state => {
            hydrateCategoryOrders(state);
            const card = state.cards.find(item => item.id === id && (admin || item.published));
            if (!card) throw new CommunityError(404, '角色卡不存在或已下架。');
            return normalizeCard(card);
        });
    }

    async updateCard(id, patch) {
        if (!validId(id) || !patch || typeof patch !== 'object') throw new CommunityError(400, '无效的角色卡更新。');
        return this.locked(state => {
            hydrateCategoryOrders(state);
            const card = state.cards.find(item => item.id === id);
            if (!card) throw new CommunityError(404, '角色卡不存在。');
            const oldRating = cardRating(card.rating);
            const ratingChanged = Object.hasOwn(patch, 'rating') && cardRating(patch.rating) !== oldRating;
            const nextRating = ratingChanged ? cardRating(patch.rating) : oldRating;
            const oldBase = ratingChanged && card.published ? orderBase(publishedCards(state, oldRating), oldRating) : null;
            if (Object.hasOwn(patch, 'name')) {
                const name = cardText(patch.name, 100);
                if (!name) throw new CommunityError(400, '角色卡名称不能为空。');
                card.name = name;
            }
            if (Object.hasOwn(patch, 'description')) card.description = cardText(patch.description, 600);
            if (Object.hasOwn(patch, 'detail')) card.detail = cardText(patch.detail, 12000);
            if (ratingChanged) {
                ensureCategoryOrders(card);
                if (card.published) card.published = false;
                card.rating = nextRating;
                if (card.published === false && oldBase !== null) card.published = true;
                if (card.published) {
                    const max = publishedCards(state, nextRating).filter(item => item.id !== id).reduce((value, item) => Math.max(value, orderFor(item, nextRating)), 0);
                    card.sortOrderByRating[nextRating] = max + 10;
                    card.sortOrder = max + 10;
                    renumberPublished(state, oldRating, null, oldBase);
                }
            }
            if (Object.hasOwn(patch, 'sortOrder')) {
                const order = Number(patch.sortOrder);
                if (!Number.isInteger(order) || order < 0 || order > 1000000) throw new CommunityError(400, '排序号应为 0～1000000 的整数。');
                ensureCategoryOrders(card)[nextRating] = order;
                card.sortOrder = order;
            }
            if (Object.hasOwn(patch, 'tags')) {
                if (!Array.isArray(patch.tags)) throw new CommunityError(400, '标签格式无效。');
                card.tags = patch.tags.filter(tag => typeof tag === 'string').slice(0, 12).map(tag => tag.trim().slice(0, 30)).filter(Boolean);
            }
            if (Object.hasOwn(patch, 'importNotice')) {
                if (patch.importNotice === null || patch.importNotice === '') card.importNotice = null;
                else if (typeof patch.importNotice === 'object') {
                    const text = cardText(patch.importNotice.text, 2000);
                    card.importNotice = text ? { mode: patch.importNotice.mode === 'required' ? 'required' : 'recommended', text } : null;
                } else throw new CommunityError(400, '导入注意事项格式无效。');
            }
            this.save(state);
            return normalizeCard(card);
        });
    }

    async setPublished(id, published) {
        if (!validId(id) || typeof published !== 'boolean') throw new CommunityError(400, '无效的上架操作。');
        return this.locked(state => {
            hydrateCategoryOrders(state);
            const card = state.cards.find(item => item.id === id);
            if (!card) throw new CommunityError(404, '角色卡不存在。');
            const rating = cardRating(card.rating);
            const base = orderBase(publishedCards(state, rating), rating);
            ensureCategoryOrders(card);
            card.published = published;
            if (published) {
                const max = publishedCards(state, rating).filter(item => item.id !== id).reduce((value, item) => Math.max(value, orderFor(item, rating)), 0);
                card.sortOrderByRating[rating] = max + 10;
                card.sortOrder = max + 10;
            } else {
                renumberPublished(state, rating, null, base);
            }
            this.save(state);
        });
    }

    async reorderCards(orderedIds, rating) {
        if (!Array.isArray(orderedIds) || !ORDER_RATINGS.includes(rating)) throw new CommunityError(400, '排序列表格式无效。');
        return this.locked(state => {
            hydrateCategoryOrders(state);
            const ordered = renumberPublished(state, rating, orderedIds);
            this.save(state);
            return ordered.map(normalizeCard);
        });
    }

    async reorderCardsByRating(orderedIdsByRating) {
        if (!orderedIdsByRating || typeof orderedIdsByRating !== 'object') throw new CommunityError(400, '排序列表格式无效。');
        return this.locked(state => {
            hydrateCategoryOrders(state);
            const result = [];
            for (const rating of ORDER_RATINGS) {
                if (!Array.isArray(orderedIdsByRating[rating])) throw new CommunityError(400, '排序列表格式无效。');
                result.push(...renumberPublished(state, rating, orderedIdsByRating[rating]));
            }
            this.save(state);
            return result.map(normalizeCard);
        });
    }

    async deleteCard(id) {
        if (!validId(id)) throw new CommunityError(404, '角色卡不存在。');
        return this.locked(async state => {
            hydrateCategoryOrders(state);
            const index = state.cards.findIndex(item => item.id === id);
            if (index < 0) throw new CommunityError(404, '角色卡不存在。');
            const card = state.cards[index];
            const rating = cardRating(card.rating);
            const base = orderBase(publishedCards(state, rating), rating);
            const paths = this.cardPaths(card.id, card.format);
            await Promise.all([fs.rm(paths.file, { force: true }), fs.rm(paths.cover, { force: true })]);
            state.cards.splice(index, 1);
            renumberPublished(state, rating, null, base);
            this.save(state);
        });
    }
}
