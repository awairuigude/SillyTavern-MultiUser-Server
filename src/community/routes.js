import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { imageSize } from 'image-size';
import { CommunityError, CommunityStore } from './store.js';
import { createUserAccount } from './create-user.js';
import { getConfigValue } from '../util.js';
import { getIpAddress, retryAfter } from '../express-common.js';
import { read as readCard } from '../character-card-parser.js';
import { TavernCardValidator } from '../validator/TavernCardValidator.js';
import { Jimp } from '../jimp.js';
import { importPublishedCard } from './import-card.js';

const publicRouter = express.Router();
const privateRouter = express.Router();
const limiter = new RateLimiterMemory({ points: 8, duration: 600 });
let instance;
let uploadBusy = false;
const store = () => instance ??= new CommunityStore(path.join(globalThis.DATA_ROOT, '_community'));
const enabled = () => getConfigValue('community.enabled', false, 'boolean') && getConfigValue('enableUserAccounts', false, 'boolean');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024, files: 1, fields: 12 } }).single('card');

function wrap(callback) {
    return async (request, response) => {
        try {
            await callback(request, response);
        } catch (error) {
            if (error instanceof RateLimiterRes) return retryAfter(response, error).status(429).json({ error: '注册尝试过于频繁，请稍后再试。' });
            if (error instanceof CommunityError) return response.status(error.status).json({ error: error.message });
            console.error('Community request failed:', error);
            return response.status(500).json({ error: '操作未完成，请稍后重试。' });
        }
    };
}

function requireEnabled(_request, response, next) {
    if (!enabled()) return response.status(404).json({ error: '角色广场尚未启用。' });
    next();
}

function requireAdmin(request, response, next) {
    if (!request.user?.profile?.admin) return response.status(403).json({ error: '仅管理员可以执行此操作。' });
    next();
}

publicRouter.get('/registration', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json({ enabled: !!enabled() });
});

publicRouter.post('/register', requireEnabled, wrap(async (request, response) => {
    await limiter.consume(getIpAddress(request, !!getConfigValue('rateLimiting.preferRealIpHeader', false, 'boolean')));
    const { handle, password, name, invite } = request.body ?? {};
    if (typeof handle !== 'string' || !/^[a-z0-9][a-z0-9-]{2,31}$/.test(handle) || handle === 'default-user') {
        throw new CommunityError(400, '用户名需为 3～32 位小写字母、数字或短横线，且以字母或数字开头。');
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw new CommunityError(400, '密码需为 8～128 个字符。');
    }
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) {
        throw new CommunityError(400, '请填写不超过 60 个字符的昵称。');
    }
    const result = await store().register(invite, handle, () => createUserAccount({ handle, name: name.trim(), password, admin: false }));
    response.status(201).json(result);
}));

privateRouter.use(requireEnabled);
privateRouter.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
});

privateRouter.get('/cards', wrap(async (request, response) => {
    const admin = !!request.user.profile.admin;
    response.json({ admin, handle: request.user.profile.handle, name: request.user.profile.name, cards: await store().listCards(admin) });
}));

privateRouter.get('/cards/:id/file', wrap(async (request, response) => {
    const card = await store().getCard(request.params.id, !!request.user.profile.admin);
    response.type(card.format === 'png' ? 'image/png' : 'application/json');
    response.setHeader('Content-Disposition', `attachment; filename="card.${card.format}"`);
    response.sendFile(store().cardPaths(card.id, card.format).file);
}));

privateRouter.get('/cards/:id/cover', wrap(async (request, response) => {
    const card = await store().getCard(request.params.id, !!request.user.profile.admin);
    if (!card.hasCover) return response.sendStatus(404);
    response.type('image/png').sendFile(store().cardPaths(card.id, card.format).cover);
}));

privateRouter.post('/cards/:id/import', wrap(async (request, response) => {
    const card = await store().getCard(request.params.id, !!request.user.profile.admin);
    response.json(await importPublishedCard(store(), card, request));
}));

privateRouter.get('/invites', requireAdmin, wrap(async (_request, response) => response.json(await store().listInvites())));
privateRouter.post('/invites', requireAdmin, wrap(async (request, response) => response.status(201).json(await store().createInvite(request.body?.days ?? 7))));
privateRouter.post('/invites/:id/revoke', requireAdmin, wrap(async (request, response) => {
    await store().revokeInvite(request.params.id);
    response.sendStatus(204);
}));

privateRouter.post('/cards/:id/publish', requireAdmin, wrap(async (request, response) => {
    await store().setPublished(request.params.id, request.body?.published);
    response.sendStatus(204);
}));

privateRouter.patch('/cards/reorder', requireAdmin, wrap(async (request, response) => {
    const body = request.body ?? {};
    const cards = body.orderedIdsByRating
        ? await store().reorderCardsByRating(body.orderedIdsByRating)
        : await store().reorderCards(body.orderedIds, body.rating);
    response.json({ cards });
}));

privateRouter.delete('/cards/:id', requireAdmin, wrap(async (request, response) => {
    await store().deleteCard(request.params.id);
    response.sendStatus(204);
}));

privateRouter.patch('/cards/:id', requireAdmin, wrap(async (request, response) => {
    response.json(await store().updateCard(request.params.id, request.body));
}));

privateRouter.post('/cards', requireAdmin, (request, response, next) => {
    if (uploadBusy) return response.status(429).json({ error: '正在处理另一张角色卡，请稍后再试。' });
    uploadBusy = true;
    let released = false;
    const release = () => { if (!released) { uploadBusy = false; released = true; } };
    response.once('finish', release);
    response.once('close', release);
    upload(request, response, error => {
        if (error) return response.status(400).json({ error: '请选择一个不超过 32 MiB 的 PNG 或 JSON 角色卡文件。' });
        next();
    });
}, wrap(async (request, response) => {
    if (!request.file) throw new CommunityError(400, '请选择角色卡文件。');
    const format = path.extname(request.file.originalname).slice(1).toLowerCase();
    if (!['png', 'json'].includes(format)) throw new CommunityError(400, '当前支持 PNG 和 JSON 角色卡。');
    let card;
    let cover;
    try {
        if (format === 'png') {
            const dimensions = imageSize(request.file.buffer);
            if (dimensions.type !== 'png' || !dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 16777216) {
                throw new Error('Image dimensions exceed the limit');
            }
            card = JSON.parse(readCard(request.file.buffer));
            const image = await Jimp.read(request.file.buffer);
            image.cover({ w: 360, h: 480 });
            cover = await image.getBuffer('image/png');
        } else {
            card = JSON.parse(request.file.buffer.toString('utf8').replace(/^\uFEFF/, ''));
        }
        if (!card || typeof card !== 'object' || !new TavernCardValidator(card).validate()) throw new Error('Invalid card');
    } catch {
        throw new CommunityError(400, '无法读取角色卡，请提供有效的酒馆 PNG 或 JSON 角色卡。');
    }
    const data = card.data ?? card;
    if (typeof data.name !== 'string' || !data.name.trim()) throw new CommunityError(400, '角色卡缺少名称。');
    const text = (value, length) => typeof value === 'string' ? value.trim().slice(0, length) : '';
    const hasDescription = Object.hasOwn(request.body ?? {}, 'description');
    const noticeText = text(request.body.importNotice, 2000);
    const rawSortOrder = typeof request.body.sortOrder === 'string' && request.body.sortOrder.trim() === '' ? null : Number(request.body.sortOrder);
    const metadata = {
        name: text(request.body.displayName, 100) || text(data.name, 100), creator: text(data.creator, 100),
        description: hasDescription ? text(request.body.description, 600) : text(data.description, 300),
        detail: text(request.body.detail, 12000),
        rating: request.body.rating === 'sfw' ? 'sfw' : 'nsfw',
        sortOrder: Number.isInteger(rawSortOrder) && rawSortOrder >= 0 ? rawSortOrder : null,
        importNotice: noticeText ? { mode: request.body.importNoticeMode === 'required' ? 'required' : 'recommended', text: noticeText } : null,
        tags: Array.isArray(data.tags) ? data.tags.filter(tag => typeof tag === 'string').slice(0, 12).map(tag => tag.slice(0, 30)) : [],
        format, bytes: request.file.size,
    };
    response.status(201).json(await store().publishCard(metadata, request.file.buffer, cover));
}));

export { publicRouter, privateRouter };
