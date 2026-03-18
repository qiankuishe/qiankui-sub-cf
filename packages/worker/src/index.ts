import { Hono } from 'hono';
import { NAVIGATION_SEED } from './navigation-seed';
import {
  detectFormatFromUserAgent,
  detectInputFormat,
  deduplicateNodes,
  ensureHttpsUrl,
  fixUrl,
  parseContent,
  parseMixedInput,
  parseSubQuery,
  renderFormat,
  type AggregateMeta,
  type AggregateWarning,
  type CachedFormatPayload,
  type CachedNodesPayload,
  type LogRecord,
  type NormalizedNode,
  type OutputFormat,
  type SourceRecord,
  type ValidationSummary
} from '@qiankui-sub-cf/shared';

export interface Env {
  APP_KV: KVNamespace;
  CACHE_KV: KVNamespace;
  ASSETS?: Fetcher;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD_HASH?: string;
  SUB_TOKEN?: string;
  AGGREGATE_TTL_SECONDS?: string;
  MAX_LOG_ENTRIES?: string;
}

type Bindings = { Bindings: Env };

interface LoginAttemptState {
  count: number;
  lastAttempt: number;
  lockedUntil: number;
  lockLevel: number;
}

interface NavigationCategoryRecord {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface NavigationLinkRecord {
  id: string;
  categoryId: string;
  title: string;
  url: string;
  description: string;
  sortOrder: number;
  visitCount: number;
  lastVisitedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NavigationCategoryPayload extends NavigationCategoryRecord {
  links: NavigationLinkRecord[];
}

interface NoteRecord {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

type SnippetType = 'text' | 'code' | 'link' | 'image';

interface SnippetRecord {
  id: string;
  type: SnippetType;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

const app = new Hono<Bindings>();

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const RESET_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_REDIRECTS = 3;
const MAX_IMAGE_SNIPPET_BYTES = 350 * 1024;
const MAX_FAVICON_BYTES = 64 * 1024;
const FAVICON_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const LOCK_LEVELS = [
  { attempts: 10, durationMs: 5 * 60 * 1000 },
  { attempts: 8, durationMs: 15 * 60 * 1000 },
  { attempts: 5, durationMs: 30 * 60 * 1000 },
  { attempts: 2, durationMs: 60 * 60 * 1000 }
];

const APP_KEYS = {
  subToken: 'config:sub-token',
  aggregateMeta: 'config:aggregate-meta',
  navigationSeeded: 'config:navigation-seeded',
  sourceIndex: 'source:index',
  logsRecent: 'logs:recent',
  navCategoryIndex: 'nav:category:index',
  noteIndex: 'note:index',
  snippetIndex: 'snippet:index'
};

const CACHE_KEYS = {
  nodes: 'cache:nodes',
  format: (format: OutputFormat) => `cache:format:${format}`,
  dns: (host: string, type: string) => `dns:${host}:${type}`,
  favicon: (hostname: string) => `favicon:${hostname}`
};

app.use('*', async (c, next) => {
  const redirected = enforceHttps(c.req.raw);
  if (redirected) {
    return redirected;
  }
  await next();
});

app.get('/app', (c) => c.redirect('/', 302));
app.get('/app/nav', (c) => c.redirect('/nav', 302));
app.get('/app/subscriptions', (c) => c.redirect('/subscriptions', 302));
app.get('/app/notes', (c) => c.redirect('/notes', 302));
app.get('/app/snippets', (c) => c.redirect('/snippets', 302));
app.get('/app/logs', (c) => c.redirect('/logs', 302));
app.get('/app/settings', (c) => c.redirect('/settings', 302));

app.get('/health', (c) => c.json({ status: 'ok' }));

app.post('/api/auth/login', async (c) => {
  const body = await readJson<{ username?: string; password?: string }>(c.req.raw);
  const username = body.username ?? '';
  const password = body.password ?? '';
  const ip = getClientIp(c.req.raw);

  const lockState = await getLoginAttempt(c.env, ip);
  const remainingLockMs = getRemainingLockMs(lockState);
  if (remainingLockMs > 0) {
    await appendLog(c.env, 'login_blocked', `IP ${ip} 被锁定，剩余 ${Math.ceil(remainingLockMs / 60000)} 分钟`);
    return c.json({ error: `登录尝试次数过多，请 ${Math.ceil(remainingLockMs / 60000)} 分钟后再试` }, 429);
  }

  const expectedUser = c.env.ADMIN_USERNAME ?? 'admin';
  const expectedHash = c.env.ADMIN_PASSWORD_HASH ?? '';
  const providedHash = await sha256Hex(password);

  if (username === expectedUser && expectedHash && safeEqual(providedHash, expectedHash)) {
    await clearLoginAttempt(c.env, ip);
    const sessionToken = await createSession(c.env, username);
    await appendLog(c.env, 'login', `用户 ${username} 登录成功`);
    c.header(
      'Set-Cookie',
      serializeCookie('session', sessionToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'Strict',
        secure: true,
        maxAge: SESSION_TTL_SECONDS
      })
    );
    return c.json({ success: true });
  }

  const updated = await recordFailedAttempt(c.env, ip, lockState);
  await appendLog(c.env, 'login_failed', `用户 ${username} 登录失败，IP: ${ip}`);
  if (updated.lockedUntil > Date.now()) {
    return c.json({ error: `登录尝试次数过多，请 ${Math.ceil((updated.lockedUntil - Date.now()) / 60000)} 分钟后再试` }, 429);
  }

  return c.json(
    {
      error: `用户名或密码错误，还剩 ${getRemainingAttempts(updated)} 次尝试机会`
    },
    401
  );
});

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c.req.raw, 'session');
  if (token) {
    await c.env.APP_KV.delete(sessionKey(token));
  }
  await appendLog(c.env, 'logout', '用户登出');
  c.header(
    'Set-Cookie',
    serializeCookie('session', '', {
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
      secure: true,
      maxAge: 0
    })
  );
  return c.json({ success: true });
});

app.get('/api/auth/check', async (c) => {
  const authenticated = await requireSession(c.env, c.req.raw);
  return c.json({ authenticated: Boolean(authenticated) });
});

app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) {
    return next();
  }

  const session = await requireSession(c.env, c.req.raw);
  if (!session) {
    return c.json({ error: '未登录或登录已过期' }, 401);
  }

  await next();
});

app.get('/api/sources', async (c) => {
  const sources = await getAllSources(c.env);
  return c.json({
    sources,
    lastSaveTime: getLastSaveTime(sources)
  });
});

app.get('/api/sources/:id', async (c) => {
  const source = await getSource(c.env, c.req.param('id'));
  if (!source) {
    return c.json({ error: '订阅源不存在' }, 404);
  }
  return c.json(source);
});

app.post('/api/sources/validate', async (c) => {
  const body = await readJson<{ content?: string }>(c.req.raw);
  const result = await validateContent(c.env, body.content ?? '');
  return c.json(result);
});

app.post('/api/sources', async (c) => {
  const body = await readJson<{ name?: string; content?: string }>(c.req.raw);
  if (!body.name?.trim() || !body.content?.trim()) {
    return c.json({ error: '名称和内容不能为空' }, 400);
  }

  const validation = await validateContent(c.env, body.content);
  const source = await createSource(c.env, body.name.trim(), body.content.trim(), validation.nodeCount);
  await appendLog(c.env, 'source_create', `创建订阅源: ${source.name}`);
  return c.json({ source, lastSaveTime: source.updatedAt });
});

app.put('/api/sources/reorder', async (c) => {
  const body = await readJson<{ ids?: string[] }>(c.req.raw);
  const ids = body.ids ?? [];
  const sources = await getAllSources(c.env);
  const idSet = new Set(sources.map((source) => source.id));
  if (ids.some((id: string) => !idSet.has(id)) || ids.length !== sources.length) {
    return c.json({ error: '排序数据无效' }, 400);
  }

  await saveSourceIndex(c.env, ids);
  const now = new Date().toISOString();
  await Promise.all(
    sources.map((source) =>
      saveSource(c.env, {
        ...source,
        sortOrder: ids.indexOf(source.id),
        updatedAt: now
      })
    )
  );
  await appendLog(c.env, 'source_reorder', '更新订阅源排序');
  return c.json({ success: true, lastSaveTime: now });
});

app.put('/api/sources/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readJson<{ name?: string; content?: string }>(c.req.raw);
  const existing = await getSource(c.env, id);
  if (!existing) {
    return c.json({ error: '订阅源不存在' }, 404);
  }

  let nodeCount = existing.nodeCount;
  if (typeof body.content === 'string') {
    const validation = await validateContent(c.env, body.content);
    nodeCount = validation.nodeCount;
  }

  const updated = await saveSource(c.env, {
    ...existing,
    name: body.name?.trim() || existing.name,
    content: typeof body.content === 'string' ? body.content.trim() : existing.content,
    nodeCount,
    updatedAt: new Date().toISOString()
  });
  await appendLog(c.env, 'source_update', `更新订阅源: ${updated.name}`);
  return c.json({ source: updated, lastSaveTime: updated.updatedAt });
});

app.delete('/api/sources/:id', async (c) => {
  const id = c.req.param('id');
  const source = await getSource(c.env, id);
  if (!source) {
    return c.json({ error: '订阅源不存在' }, 404);
  }
  await deleteSource(c.env, id);
  await appendLog(c.env, 'source_delete', `删除订阅源: ${source.name}`);
  return c.json({ success: true, lastSaveTime: new Date().toISOString() });
});

app.post('/api/sources/refresh', async (c) => {
  const refresh = await refreshAggregateCache(c.env, true);
  if (!refresh.ok) {
    return c.json({ error: refresh.error }, 500);
  }

  await appendLog(c.env, 'source_refresh', `手动刷新订阅缓存，共 ${refresh.payload.nodes.length} 条节点`);
  return c.json({
    sources: refresh.sources,
    lastSaveTime: getLastSaveTime(refresh.sources)
  });
});

app.get('/api/sub/info', async (c) => {
  const subToken = await getSubToken(c.env);
  const baseUrl = getHttpsOrigin(c.req.raw);
  const meta = await getAggregateMeta(c.env);
  return c.json({
    formats: [
      { name: '自适应', key: 'auto', url: `${baseUrl}/sub?${subToken}` },
      { name: 'Base64', key: 'base64', url: `${baseUrl}/sub?${subToken}&base64` },
      { name: 'Clash', key: 'clash', url: `${baseUrl}/sub?${subToken}&clash` },
      { name: 'Stash', key: 'stash', url: `${baseUrl}/sub?${subToken}&stash` },
      { name: 'Surge', key: 'surge', url: `${baseUrl}/sub?${subToken}&surge` },
      { name: 'Loon', key: 'loon', url: `${baseUrl}/sub?${subToken}&loon` },
      { name: 'SingBox', key: 'singbox', url: `${baseUrl}/sub?${subToken}&singbox` },
      { name: 'Quantumult X', key: 'qx', url: `${baseUrl}/sub?${subToken}&qx` }
    ],
    totalNodes: meta.totalNodes,
    lastAggregateTime: meta.lastRefreshTime,
    cacheStatus: meta.cacheStatus,
    lastRefreshTime: meta.lastRefreshTime,
    lastRefreshError: meta.lastRefreshError,
    warningCount: meta.warningCount
  });
});

app.get('/api/logs', async (c) => {
  const limit = Number.parseInt(c.req.query('limit') || '50', 10);
  const logs = await getLogs(c.env);
  return c.json({ logs: logs.slice(0, limit) });
});

app.get('/api/navigation', async (c) => {
  const categories = await getNavigationTree(c.env);
  return c.json({
    categories,
    totalCategories: categories.length,
    totalLinks: categories.reduce((sum, category) => sum + category.links.length, 0)
  });
});

app.get('/api/favicon', async (c) => {
  const rawUrl = c.req.query('url')?.trim();
  if (!rawUrl) {
    return c.json({ error: '缺少 url 参数' }, 400);
  }

  let hostname = '';
  try {
    hostname = new URL(fixUrl(rawUrl)).hostname.toLowerCase();
  } catch {
    return c.json({ error: 'favicon url 无效' }, 400);
  }

  if (!hostname) {
    return c.json({ error: 'favicon host 无效' }, 400);
  }

  const cached = await c.env.CACHE_KV.get(CACHE_KEYS.favicon(hostname), 'json');
  if (cached && typeof cached === 'object' && typeof (cached as { dataUrl?: unknown }).dataUrl === 'string') {
    return c.json({ dataUrl: (cached as { dataUrl: string }).dataUrl, cached: true });
  }

  const fetched = await fetchAndCacheFavicon(c.env, hostname);
  if (!fetched) {
    return c.json({ error: '未找到可用 favicon' }, 404);
  }

  return c.json({ dataUrl: fetched, cached: false });
});

app.post('/api/navigation/categories', async (c) => {
  const body = await readJson<{ name?: string }>(c.req.raw);
  const name = body.name?.trim();
  if (!name) {
    return c.json({ error: '分类名称不能为空' }, 400);
  }

  const category = await createNavigationCategory(c.env, name);
  await appendLog(c.env, 'nav_category_create', `创建导航分类: ${category.name}`);
  return c.json({ category });
});

app.put('/api/navigation/categories/reorder', async (c) => {
  const body = await readJson<{ ids?: string[] }>(c.req.raw);
  const ids = body.ids ?? [];
  const categories = await getNavigationCategories(c.env);
  const idSet = new Set(categories.map((category) => category.id));
  if (ids.length !== categories.length || ids.some((id) => !idSet.has(id))) {
    return c.json({ error: '分类排序数据无效' }, 400);
  }

  const reordered = await reorderNavigationCategories(c.env, ids);
  return c.json({ categories: reordered });
});

app.put('/api/navigation/categories/:id', async (c) => {
  const body = await readJson<{ name?: string }>(c.req.raw);
  const category = await getNavigationCategory(c.env, c.req.param('id'));
  if (!category) {
    return c.json({ error: '分类不存在' }, 404);
  }

  const name = body.name?.trim();
  if (!name) {
    return c.json({ error: '分类名称不能为空' }, 400);
  }

  const updated = await saveNavigationCategory(c.env, {
    ...category,
    name,
    updatedAt: new Date().toISOString()
  });
  return c.json({ category: updated });
});

app.delete('/api/navigation/categories/:id', async (c) => {
  const category = await getNavigationCategory(c.env, c.req.param('id'));
  if (!category) {
    return c.json({ error: '分类不存在' }, 404);
  }

  await deleteNavigationCategory(c.env, category.id);
  await appendLog(c.env, 'nav_category_delete', `删除导航分类: ${category.name}`);
  return c.json({ success: true });
});

app.post('/api/navigation/links', async (c) => {
  const body = await readJson<{ categoryId?: string; title?: string; url?: string; description?: string }>(c.req.raw);
  const title = body.title?.trim();
  const url = body.url?.trim();
  const categoryId = body.categoryId?.trim();

  if (!categoryId || !title || !url) {
    return c.json({ error: '分类、标题和链接不能为空' }, 400);
  }

  if (!isSafeNavigationUrl(url)) {
    return c.json({ error: '站点链接必须是 http 或 https 地址' }, 400);
  }

  const category = await getNavigationCategory(c.env, categoryId);
  if (!category) {
    return c.json({ error: '分类不存在' }, 404);
  }

  const link = await createNavigationLink(c.env, {
    categoryId,
    title,
    url,
    description: body.description?.trim() ?? ''
  });
  await appendLog(c.env, 'nav_link_create', `创建导航站点: ${link.title}`);
  return c.json({ link });
});

app.post('/api/navigation/links/:id/visit', async (c) => {
  const link = await getNavigationLink(c.env, c.req.param('id'));
  if (!link) {
    return c.json({ error: '站点不存在' }, 404);
  }

  const updated = await recordNavigationLinkVisit(c.env, link);
  return c.json({
    visitCount: updated.visitCount,
    lastVisitedAt: updated.lastVisitedAt
  });
});

app.put('/api/navigation/links/reorder', async (c) => {
  const body = await readJson<{ categoryId?: string; ids?: string[] }>(c.req.raw);
  const categoryId = body.categoryId?.trim();
  const ids = body.ids ?? [];
  if (!categoryId) {
    return c.json({ error: '缺少分类标识' }, 400);
  }

  const category = await getNavigationCategory(c.env, categoryId);
  if (!category) {
    return c.json({ error: '分类不存在' }, 404);
  }

  const links = await getNavigationLinksByCategory(c.env, categoryId);
  const idSet = new Set(links.map((link) => link.id));
  if (ids.length !== links.length || ids.some((id) => !idSet.has(id))) {
    return c.json({ error: '站点排序数据无效' }, 400);
  }

  const reordered = await reorderNavigationLinks(c.env, categoryId, ids);
  return c.json({ links: reordered });
});

app.put('/api/navigation/links/:id', async (c) => {
  const body = await readJson<{ categoryId?: string; title?: string; url?: string; description?: string }>(c.req.raw);
  const link = await getNavigationLink(c.env, c.req.param('id'));
  if (!link) {
    return c.json({ error: '站点不存在' }, 404);
  }

  const nextCategoryId = body.categoryId?.trim() ?? link.categoryId;
  if (!(await getNavigationCategory(c.env, nextCategoryId))) {
    return c.json({ error: '目标分类不存在' }, 404);
  }

  const nextUrl = body.url?.trim() ?? link.url;
  if (!isSafeNavigationUrl(nextUrl)) {
    return c.json({ error: '站点链接必须是 http 或 https 地址' }, 400);
  }

  const updated = await updateNavigationLink(c.env, link, {
    categoryId: nextCategoryId,
    title: body.title?.trim() ?? link.title,
    url: nextUrl,
    description: body.description?.trim() ?? link.description
  });
  return c.json({ link: updated });
});

app.delete('/api/navigation/links/:id', async (c) => {
  const link = await getNavigationLink(c.env, c.req.param('id'));
  if (!link) {
    return c.json({ error: '站点不存在' }, 404);
  }

  await deleteNavigationLink(c.env, link.id, link.categoryId);
  await appendLog(c.env, 'nav_link_delete', `删除导航站点: ${link.title}`);
  return c.json({ success: true });
});

app.get('/api/notes', async (c) => {
  const notes = await getAllNotes(c.env);
  return c.json({ notes });
});

app.post('/api/notes', async (c) => {
  const body = await readJson<{ title?: string; content?: string }>(c.req.raw);
  const note = await createNoteRecord(c.env, body.title?.trim() || '新笔记', body.content ?? '');
  return c.json({ note });
});

app.put('/api/notes/:id', async (c) => {
  const body = await readJson<{ title?: string; content?: string; isPinned?: boolean }>(c.req.raw);
  const note = await getNoteRecord(c.env, c.req.param('id'));
  if (!note) {
    return c.json({ error: '笔记不存在' }, 404);
  }

  const updated = await saveNoteRecord(c.env, {
    ...note,
    title: body.title?.trim() || note.title,
    content: typeof body.content === 'string' ? body.content : note.content,
    isPinned: typeof body.isPinned === 'boolean' ? body.isPinned : note.isPinned,
    updatedAt: new Date().toISOString()
  });
  return c.json({ note: updated });
});

app.delete('/api/notes/:id', async (c) => {
  const note = await getNoteRecord(c.env, c.req.param('id'));
  if (!note) {
    return c.json({ error: '笔记不存在' }, 404);
  }

  await deleteNoteRecord(c.env, note.id);
  return c.json({ success: true });
});

app.get('/api/snippets', async (c) => {
  const type = c.req.query('type');
  const query = c.req.query('q');
  const snippets = await getAllSnippets(c.env, {
    type: isSnippetType(type) ? type : undefined,
    query: query?.trim()
  });
  return c.json({ snippets });
});

app.post('/api/snippets', async (c) => {
  const body = await readJson<{ type?: string; title?: string; content?: string }>(c.req.raw);
  if (!isSnippetType(body.type)) {
    return c.json({ error: '片段类型无效' }, 400);
  }

  const title = body.title?.trim() || getDefaultSnippetTitle(body.type);
  const content = body.content ?? '';
  if (body.type === 'image' && getByteLength(content) > MAX_IMAGE_SNIPPET_BYTES) {
    return c.json({ error: '图片片段过大，请使用更小的图片或压缩后再试' }, 400);
  }

  const snippet = await createSnippetRecord(c.env, {
    type: body.type,
    title,
    content
  });
  return c.json({ snippet });
});

app.put('/api/snippets/:id', async (c) => {
  const body = await readJson<{ type?: string; title?: string; content?: string; isPinned?: boolean }>(c.req.raw);
  const snippet = await getSnippetRecord(c.env, c.req.param('id'));
  if (!snippet) {
    return c.json({ error: '片段不存在' }, 404);
  }

  const nextType = isSnippetType(body.type) ? body.type : snippet.type;
  const nextContent = typeof body.content === 'string' ? body.content : snippet.content;
  if (nextType === 'image' && getByteLength(nextContent) > MAX_IMAGE_SNIPPET_BYTES) {
    return c.json({ error: '图片片段过大，请使用更小的图片或压缩后再试' }, 400);
  }

  const updated = await saveSnippetRecord(c.env, {
    ...snippet,
    type: nextType,
    title: body.title?.trim() || snippet.title,
    content: nextContent,
    isPinned: typeof body.isPinned === 'boolean' ? body.isPinned : snippet.isPinned,
    updatedAt: new Date().toISOString()
  });
  return c.json({ snippet: updated });
});

app.delete('/api/snippets/:id', async (c) => {
  const snippet = await getSnippetRecord(c.env, c.req.param('id'));
  if (!snippet) {
    return c.json({ error: '片段不存在' }, 404);
  }

  await deleteSnippetRecord(c.env, snippet.id);
  return c.json({ success: true });
});

app.get('/sub', async (c) => {
  const url = new URL(c.req.url);
  const { token, format: queryFormat } = parseSubQuery(url.searchParams);
  const subToken = await getSubToken(c.env);
  if (!token || token !== subToken) {
    return c.json({ error: '无效的订阅 token' }, 401);
  }

  const format = queryFormat ?? detectFormatFromUserAgent(c.req.header('user-agent') || '');
  const cacheResult = await ensureAggregateCache(c.env, format);
  if (!cacheResult.ok) {
    return c.json({ error: cacheResult.error }, 500);
  }

  const { content, warnings, fromStaleCache } = cacheResult.payload;
  await appendLog(c.env, 'subscription', `订阅请求: format=${format}, nodes=${cacheResult.meta.totalNodes}, stale=${String(fromStaleCache)}`);
  const contentType = format === 'singbox' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
  c.header('Content-Type', contentType);
  c.header('Content-Disposition', `attachment; filename="qiankui-${format}.txt"`);
  c.header('X-Qiankui-Cache-Status', cacheResult.meta.cacheStatus);
  c.header('X-Qiankui-Warning-Count', String(warnings.length));
  return c.body(content);
});

app.notFound(async (c) => {
  if (c.env.ASSETS) {
    const pageAssetPath = resolvePageAssetPath(c.req.raw);
    if (pageAssetPath) {
      const pageUrl = new URL(pageAssetPath, c.req.raw.url);
      return c.env.ASSETS.fetch(new Request(pageUrl.toString(), c.req.raw));
    }
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

export default {
  fetch: app.fetch,
  scheduled: async (_controller: ScheduledController, env: Env, _ctx: ExecutionContext) => {
    await refreshAggregateCache(env, false);
  }
};

export { app };

function resolvePageAssetPath(request: Request): string | null {
  if (request.method !== 'GET') {
    return null;
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  if (
    pathname.startsWith('/api/') ||
    pathname === '/sub' ||
    pathname === '/health' ||
    pathname.startsWith('/assets/') ||
    pathname === '/favicon.ico' ||
    pathname === '/logo.png'
  ) {
    return null;
  }

  const pageMap: Record<string, string> = {
    '/': '/index.html',
    '/login': '/login.html',
    '/nav': '/nav.html',
    '/subscriptions': '/subscriptions.html',
    '/notes': '/notes.html',
    '/snippets': '/snippets.html',
    '/logs': '/logs.html',
    '/settings': '/settings.html'
  };

  return pageMap[pathname] ?? null;
}

function enforceHttps(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return null;
  }
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const cfVisitor = request.headers.get('cf-visitor');
  const isHttps =
    url.protocol === 'https:' ||
    forwardedProto === 'https' ||
    (cfVisitor ? cfVisitor.includes('"scheme":"https"') : false);

  if (isHttps) {
    return null;
  }

  return Response.redirect(ensureHttpsUrl(url.toString()), 308);
}

async function requireSession(env: Env, request: Request): Promise<{ username: string } | null> {
  const token = getCookie(request, 'session');
  if (!token) {
    return null;
  }
  const raw = await env.APP_KV.get(sessionKey(token), 'json');
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return raw as { username: string };
}

async function createSession(env: Env, username: string): Promise<string> {
  const token = randomToken();
  await env.APP_KV.put(sessionKey(token), JSON.stringify({ username, createdAt: Date.now() }), {
    expirationTtl: SESSION_TTL_SECONDS
  });
  return token;
}

function sessionKey(token: string): string {
  return `session:${token}`;
}

function loginAttemptKey(ip: string): string {
  return `login-attempt:${ip}`;
}

async function getLoginAttempt(env: Env, ip: string): Promise<LoginAttemptState | null> {
  const data = await env.APP_KV.get(loginAttemptKey(ip), 'json');
  if (!data || typeof data !== 'object') {
    return null;
  }
  return data as LoginAttemptState;
}

async function clearLoginAttempt(env: Env, ip: string): Promise<void> {
  await env.APP_KV.delete(loginAttemptKey(ip));
}

function getLockConfig(level: number): { attempts: number; durationMs: number } {
  return LOCK_LEVELS[Math.min(level, LOCK_LEVELS.length - 1)];
}

function getRemainingLockMs(state: LoginAttemptState | null): number {
  if (!state) {
    return 0;
  }
  return Math.max(state.lockedUntil - Date.now(), 0);
}

function getRemainingAttempts(state: LoginAttemptState): number {
  const config = getLockConfig(state.lockLevel);
  return Math.max(config.attempts - state.count, 0);
}

async function recordFailedAttempt(env: Env, ip: string, existing: LoginAttemptState | null): Promise<LoginAttemptState> {
  const now = Date.now();
  let state = existing;

  if (!state || now - state.lastAttempt > RESET_AFTER_MS) {
    state = { count: 0, lastAttempt: now, lockedUntil: 0, lockLevel: 0 };
  } else if (state.lockedUntil > 0 && state.lockedUntil <= now) {
    state = { count: 0, lastAttempt: now, lockedUntil: 0, lockLevel: state.lockLevel + 1 };
  }

  state.count += 1;
  state.lastAttempt = now;
  const lockConfig = getLockConfig(state.lockLevel);
  if (state.count >= lockConfig.attempts) {
    state.lockedUntil = now + lockConfig.durationMs;
  }

  await env.APP_KV.put(loginAttemptKey(ip), JSON.stringify(state), {
    expirationTtl: SESSION_TTL_SECONDS
  });
  return state;
}

async function validateContent(env: Env, content: string): Promise<ValidationSummary> {
  const { urls, nodes: directNodes, warnings: inputWarnings } = parseMixedInput(content);
  const resolvedNodes = [...directNodes];
  const warnings = [...inputWarnings];

  for (const rawUrl of urls) {
    try {
      const fetched = await fetchSubscription(env, rawUrl);
      const parsed = parseContent(fetched.text, detectInputFormat(fetched.text));
      resolvedNodes.push(...parsed.nodes);
      warnings.push(...parsed.warnings);
    } catch (error) {
      warnings.push({ code: 'fetch-failed', message: `拉取订阅失败: ${String(error)}`, context: rawUrl });
    }
  }

  const { nodes, duplicateCount } = deduplicateNodes(resolvedNodes);
  return {
    valid: urls.length > 0 || directNodes.length > 0,
    urlCount: urls.length,
    nodeCount: nodes.length,
    totalCount: resolvedNodes.length,
    duplicateCount,
    warnings
  };
}

async function refreshAggregateCache(env: Env, force: boolean): Promise<
  | { ok: true; payload: CachedNodesPayload; sources: SourceRecord[] }
  | { ok: false; error: string }
> {
  const sources = await getAllSources(env);
  if (sources.length === 0) {
    const meta = await saveAggregateMeta(env, {
      cacheStatus: 'missing',
      totalNodes: 0,
      warningCount: 0,
      lastRefreshTime: '',
      lastRefreshError: '没有配置订阅源'
    });
    void meta;
    return { ok: false, error: '没有配置订阅源' };
  }

  try {
    const aggregated: NormalizedNode[] = [];
    const warnings: AggregateWarning[] = [];
    const updatedSources: SourceRecord[] = [];

    for (const source of sources) {
      const expanded = await expandSourceContent(env, source.content);
      aggregated.push(...expanded.uniqueNodes);
      warnings.push(...expanded.warnings);
      const updatedSource: SourceRecord = {
        ...source,
        nodeCount: expanded.uniqueNodes.length,
        updatedAt: new Date().toISOString()
      };
      updatedSources.push(updatedSource);
      await saveSource(env, updatedSource);
    }

    const deduped = deduplicateNodes(aggregated);
    const payload: CachedNodesPayload = {
      nodes: deduped.nodes,
      warnings,
      refreshedAt: new Date().toISOString()
    };

    await env.CACHE_KV.put(CACHE_KEYS.nodes, JSON.stringify(payload));
    for (const format of ['base64', 'clash', 'stash', 'surge', 'loon', 'qx', 'singbox'] satisfies OutputFormat[]) {
      const rendered = renderFormat(payload.nodes, format);
      const cachedFormat: CachedFormatPayload = {
        format,
        content: rendered.content,
        warnings: rendered.warnings,
        refreshedAt: payload.refreshedAt
      };
      await env.CACHE_KV.put(CACHE_KEYS.format(format), JSON.stringify(cachedFormat));
    }

    await saveAggregateMeta(env, {
      cacheStatus: 'fresh',
      totalNodes: payload.nodes.length,
      warningCount: warnings.length,
      lastRefreshTime: payload.refreshedAt,
      lastRefreshError: '',
      nextRefreshAfter: new Date(Date.now() + getAggregateTtlSeconds(env) * 1000).toISOString()
    });

    return { ok: true, payload, sources: updatedSources };
  } catch (error) {
    const oldCache = await getCachedNodes(env);
    await saveAggregateMeta(env, {
      cacheStatus: oldCache ? 'stale' : 'missing',
      totalNodes: oldCache?.nodes.length ?? 0,
      warningCount: oldCache?.warnings.length ?? 0,
      lastRefreshTime: oldCache?.refreshedAt ?? '',
      lastRefreshError: String(error)
    });
    if (!force && oldCache) {
      return { ok: true, payload: oldCache, sources };
    }
    return { ok: false, error: `刷新聚合缓存失败: ${String(error)}` };
  }
}

async function ensureAggregateCache(
  env: Env,
  format: OutputFormat
): Promise<
  | {
      ok: true;
      payload: { content: string; warnings: AggregateWarning[]; fromStaleCache: boolean };
      meta: AggregateMeta;
    }
  | { ok: false; error: string }
> {
  const ttlSeconds = getAggregateTtlSeconds(env);
  const meta = await getAggregateMeta(env);
  const cachedFormat = await getCachedFormat(env, format);
  const cachedNodes = await getCachedNodes(env);
  const isFresh = cachedNodes ? Date.now() - Date.parse(cachedNodes.refreshedAt) < ttlSeconds * 1000 : false;

  if (cachedFormat && cachedNodes && isFresh) {
    return {
      ok: true,
      payload: { content: cachedFormat.content, warnings: cachedFormat.warnings, fromStaleCache: false },
      meta: { ...meta, cacheStatus: 'fresh' }
    };
  }

  const refreshed = await refreshAggregateCache(env, false);
  if (refreshed.ok) {
    const latest = await getCachedFormat(env, format);
    const nextMeta = await getAggregateMeta(env);
    if (latest) {
      return {
        ok: true,
        payload: { content: latest.content, warnings: latest.warnings, fromStaleCache: nextMeta.cacheStatus === 'stale' },
        meta: nextMeta
      };
    }
  }

  if (cachedFormat) {
    return {
      ok: true,
      payload: { content: cachedFormat.content, warnings: cachedFormat.warnings, fromStaleCache: true },
      meta: { ...meta, cacheStatus: 'stale' }
    };
  }

  return { ok: false, error: refreshed.ok ? '订阅缓存不可用' : refreshed.error };
}

async function expandSourceContent(env: Env, content: string): Promise<{
  uniqueNodes: NormalizedNode[];
  warnings: AggregateWarning[];
}> {
  const { urls, nodes: directNodes, warnings } = parseMixedInput(content);
  const expandedNodes = [...directNodes];
  const extraWarnings = [...warnings];

  for (const rawUrl of urls) {
    try {
      const fetched = await fetchSubscription(env, rawUrl);
      const parsed = parseContent(fetched.text);
      expandedNodes.push(...parsed.nodes);
      extraWarnings.push(...parsed.warnings);
    } catch (error) {
      extraWarnings.push({ code: 'fetch-failed', message: `拉取订阅失败: ${String(error)}`, context: rawUrl });
    }
  }

  const deduped = deduplicateNodes(expandedNodes);
  return { uniqueNodes: deduped.nodes, warnings: extraWarnings };
}

async function fetchSubscription(env: Env, rawUrl: string, depth = 0): Promise<{ text: string }> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`重定向次数超过 ${MAX_REDIRECTS} 次`);
  }

  const url = new URL(fixUrl(rawUrl));
  await assertSafeUrl(env, url);

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': 'QianKui-Sub-CF/0.1' },
    redirect: 'manual'
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      throw new Error('上游返回重定向但缺少 Location');
    }
    const redirected = new URL(location, url);
    return fetchSubscription(env, redirected.toString(), depth + 1);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return { text: await response.text() };
}

async function fetchAndCacheFavicon(env: Env, hostname: string): Promise<string | null> {
  const faviconSources = [
    `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`,
    `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${hostname}`)}&size=64`,
    `https://${hostname}/favicon.ico`
  ];

  for (const source of faviconSources) {
    try {
      const result = await fetchFaviconSource(env, source);
      if (!result) {
        continue;
      }

      const payload = JSON.stringify({ dataUrl: result.dataUrl, cachedAt: Date.now(), source });
      await env.CACHE_KV.put(CACHE_KEYS.favicon(hostname), payload, { expirationTtl: FAVICON_CACHE_TTL_SECONDS });
      return result.dataUrl;
    } catch {
      // ignore favicon source failures and try the next one
    }
  }

  return null;
}

async function fetchFaviconSource(env: Env, rawUrl: string): Promise<{ dataUrl: string } | null> {
  const url = new URL(rawUrl);
  await assertSafeUrl(env, url);

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': 'QianKui-Sub-CF/0.1' },
    redirect: 'follow'
  });

  if (!response.ok) {
    return null;
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!looksLikeFaviconContentType(contentType)) {
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_FAVICON_BYTES) {
    return null;
  }

  const mimeType = normalizeFaviconContentType(contentType);
  return {
    dataUrl: `data:${mimeType};base64,${toBase64(bytes)}`
  };
}

function looksLikeFaviconContentType(contentType: string): boolean {
  if (!contentType) {
    return true;
  }

  return (
    contentType.startsWith('image/') ||
    contentType.includes('icon') ||
    contentType.includes('svg') ||
    contentType.includes('octet-stream')
  );
}

function normalizeFaviconContentType(contentType: string): string {
  if (!contentType) {
    return 'image/png';
  }

  return contentType.split(';', 1)[0]?.trim() || 'image/png';
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function assertSafeUrl(env: Env, url: URL): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`禁止协议: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();
  if (['localhost', 'localhost.localdomain', '0.0.0.0', '::1', '[::1]', '[::]'].includes(hostname)) {
    throw new Error(`禁止访问内网主机: ${hostname}`);
  }

  if (isInternalHostname(hostname)) {
    throw new Error(`禁止访问内网域名: ${hostname}`);
  }

  if (isIpAddress(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error(`禁止访问保留地址: ${hostname}`);
    }
    return;
  }

  const addresses = await resolveAddresses(env, hostname);
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new Error(`域名解析命中保留地址: ${hostname} -> ${address}`);
    }
  }
}

async function resolveAddresses(env: Env, hostname: string): Promise<string[]> {
  const cachedA = await getCachedDns(env, hostname, 'A');
  const cachedAAAA = await getCachedDns(env, hostname, 'AAAA');
  if (cachedA || cachedAAAA) {
    return [...(cachedA ?? []), ...(cachedAAAA ?? [])];
  }

  const [aRecords, aaaaRecords] = await Promise.all([resolveDnsType(hostname, 'A'), resolveDnsType(hostname, 'AAAA')]);
  await Promise.all([
    env.CACHE_KV.put(CACHE_KEYS.dns(hostname, 'A'), JSON.stringify(aRecords), { expirationTtl: 300 }),
    env.CACHE_KV.put(CACHE_KEYS.dns(hostname, 'AAAA'), JSON.stringify(aaaaRecords), { expirationTtl: 300 })
  ]);
  return [...aRecords, ...aaaaRecords];
}

async function getCachedDns(env: Env, hostname: string, type: 'A' | 'AAAA'): Promise<string[] | null> {
  return env.CACHE_KV.get(CACHE_KEYS.dns(hostname, type), 'json');
}

async function resolveDnsType(hostname: string, type: 'A' | 'AAAA'): Promise<string[]> {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
    headers: { Accept: 'application/dns-json' }
  });
  if (!response.ok) {
    return [];
  }
  const data = (await response.json()) as { Answer?: Array<{ data?: string; type?: number }> };
  return (data.Answer ?? [])
    .filter((record) => Boolean(record.data))
    .map((record) => String(record.data))
    .filter((value) => (type === 'A' ? isIpv4(value) : isIpv6(value)));
}

function isInternalHostname(hostname: string): boolean {
  return ['.local', '.internal', '.lan', '.home', '.corp', '.intranet'].some((suffix) => hostname.endsWith(suffix));
}

function isIpAddress(value: string): boolean {
  return isIpv4(value) || isIpv6(value);
}

function isIpv4(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function isIpv6(value: string): boolean {
  return /^[a-fA-F0-9:]+$/.test(value) && value.includes(':');
}

function isBlockedIp(value: string): boolean {
  if (isIpv4(value)) {
    return [
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^0\./,
      /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./,
      /^192\.0\.0\./,
      /^192\.0\.2\./,
      /^198\.18\./,
      /^198\.51\.100\./,
      /^203\.0\.113\./,
      /^224\./,
      /^240\./,
      /^255\./
    ].some((pattern) => pattern.test(value));
  }

  const normalized = value.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('::ffff:127.')
  );
}

async function getSource(env: Env, id: string): Promise<SourceRecord | null> {
  const source = await env.APP_KV.get(`source:${id}`, 'json');
  return source as SourceRecord | null;
}

async function getAllSources(env: Env): Promise<SourceRecord[]> {
  const ids = await getSourceIndex(env);
  const records = await Promise.all(ids.map((id) => getSource(env, id)));
  return records.filter((record): record is SourceRecord => Boolean(record)).sort((a, b) => a.sortOrder - b.sortOrder);
}

async function getSourceIndex(env: Env): Promise<string[]> {
  return (await env.APP_KV.get(APP_KEYS.sourceIndex, 'json')) ?? [];
}

async function saveSourceIndex(env: Env, ids: string[]): Promise<void> {
  await env.APP_KV.put(APP_KEYS.sourceIndex, JSON.stringify(ids));
}

async function createSource(env: Env, name: string, content: string, nodeCount: number): Promise<SourceRecord> {
  const ids = await getSourceIndex(env);
  const now = new Date().toISOString();
  const source: SourceRecord = {
    id: randomToken(8),
    name,
    content,
    nodeCount,
    sortOrder: ids.length,
    createdAt: now,
    updatedAt: now
  };
  await saveSource(env, source);
  await saveSourceIndex(env, [...ids, source.id]);
  return source;
}

async function saveSource(env: Env, source: SourceRecord): Promise<SourceRecord> {
  await env.APP_KV.put(`source:${source.id}`, JSON.stringify(source));
  return source;
}

async function deleteSource(env: Env, id: string): Promise<void> {
  const ids = await getSourceIndex(env);
  await env.APP_KV.delete(`source:${id}`);
  await saveSourceIndex(
    env,
    ids.filter((value) => value !== id)
  );
}

function getLastSaveTime(sources: SourceRecord[]): string {
  return sources.reduce((latest, source) => (source.updatedAt > latest ? source.updatedAt : latest), '');
}

async function getSubToken(env: Env): Promise<string> {
  if (env.SUB_TOKEN) {
    return env.SUB_TOKEN;
  }
  const existing = await env.APP_KV.get(APP_KEYS.subToken);
  if (existing) {
    return existing;
  }
  const created = randomToken(32);
  await env.APP_KV.put(APP_KEYS.subToken, created);
  return created;
}

async function getAggregateMeta(env: Env): Promise<AggregateMeta> {
  const meta = await env.APP_KV.get(APP_KEYS.aggregateMeta, 'json');
  if (meta && typeof meta === 'object') {
    return meta as AggregateMeta;
  }
  return {
    cacheStatus: 'missing',
    totalNodes: 0,
    warningCount: 0,
    lastRefreshTime: '',
    lastRefreshError: ''
  };
}

async function saveAggregateMeta(env: Env, meta: AggregateMeta): Promise<AggregateMeta> {
  await env.APP_KV.put(APP_KEYS.aggregateMeta, JSON.stringify(meta));
  return meta;
}

async function getCachedNodes(env: Env): Promise<CachedNodesPayload | null> {
  return env.CACHE_KV.get(CACHE_KEYS.nodes, 'json');
}

async function getCachedFormat(env: Env, format: OutputFormat): Promise<CachedFormatPayload | null> {
  return env.CACHE_KV.get(CACHE_KEYS.format(format), 'json');
}

async function appendLog(env: Env, action: string, detail?: string): Promise<void> {
  const logs = await getLogs(env);
  const next: LogRecord = {
    id: randomToken(6),
    action,
    detail: detail ?? null,
    createdAt: new Date().toISOString()
  };
  logs.unshift(next);
  await env.APP_KV.put(APP_KEYS.logsRecent, JSON.stringify(logs.slice(0, getMaxLogEntries(env))));
}

async function getLogs(env: Env): Promise<LogRecord[]> {
  return (await env.APP_KV.get(APP_KEYS.logsRecent, 'json')) ?? [];
}

async function ensureNavigationSeeded(env: Env): Promise<void> {
  const seeded = await env.APP_KV.get(APP_KEYS.navigationSeeded);
  if (seeded) {
    return;
  }

  const existingIds = await getNavigationCategoryIndex(env);
  if (existingIds.length > 0) {
    await env.APP_KV.put(APP_KEYS.navigationSeeded, '1');
    return;
  }

  const categoryIds: string[] = [];
  for (const [categoryIndex, categorySeed] of NAVIGATION_SEED.entries()) {
    const categoryId = randomToken(8);
    categoryIds.push(categoryId);
    const categoryNow = new Date().toISOString();
    const category: NavigationCategoryRecord = {
      id: categoryId,
      name: categorySeed.name,
      sortOrder: categoryIndex,
      createdAt: categoryNow,
      updatedAt: categoryNow
    };
    await saveNavigationCategory(env, category);

    const linkIds: string[] = [];
    for (const [linkIndex, linkSeed] of categorySeed.links.entries()) {
      const linkId = randomToken(8);
      linkIds.push(linkId);
      const linkNow = new Date().toISOString();
      await saveNavigationLink(env, {
        id: linkId,
        categoryId,
        title: linkSeed.title,
        url: linkSeed.url,
        description: linkSeed.description,
        sortOrder: linkIndex,
        visitCount: 0,
        lastVisitedAt: null,
        createdAt: linkNow,
        updatedAt: linkNow
      });
    }

    await saveNavigationLinkIndex(env, categoryId, linkIds);
  }

  await saveNavigationCategoryIndex(env, categoryIds);
  await env.APP_KV.put(APP_KEYS.navigationSeeded, '1');
}

async function getNavigationTree(env: Env): Promise<NavigationCategoryPayload[]> {
  await ensureNavigationSeeded(env);
  const categories = await getNavigationCategories(env);
  return Promise.all(
    categories.map(async (category) => ({
      ...category,
      links: await getNavigationLinksByCategory(env, category.id)
    }))
  );
}

async function getNavigationCategory(env: Env, id: string): Promise<NavigationCategoryRecord | null> {
  const category = await env.APP_KV.get(`nav:category:${id}`, 'json');
  return category as NavigationCategoryRecord | null;
}

async function getNavigationCategories(env: Env): Promise<NavigationCategoryRecord[]> {
  await ensureNavigationSeeded(env);
  const ids = await getNavigationCategoryIndex(env);
  const categories = await Promise.all(ids.map((id) => getNavigationCategory(env, id)));
  return categories.filter((category): category is NavigationCategoryRecord => Boolean(category)).sort((a, b) => a.sortOrder - b.sortOrder);
}

async function getNavigationCategoryIndex(env: Env): Promise<string[]> {
  return (await env.APP_KV.get(APP_KEYS.navCategoryIndex, 'json')) ?? [];
}

async function saveNavigationCategoryIndex(env: Env, ids: string[]): Promise<void> {
  await env.APP_KV.put(APP_KEYS.navCategoryIndex, JSON.stringify(ids));
}

async function saveNavigationCategory(env: Env, category: NavigationCategoryRecord): Promise<NavigationCategoryRecord> {
  await env.APP_KV.put(`nav:category:${category.id}`, JSON.stringify(category));
  return category;
}

async function createNavigationCategory(env: Env, name: string): Promise<NavigationCategoryRecord> {
  await ensureNavigationSeeded(env);
  const ids = await getNavigationCategoryIndex(env);
  const now = new Date().toISOString();
  const category: NavigationCategoryRecord = {
    id: randomToken(8),
    name,
    sortOrder: ids.length,
    createdAt: now,
    updatedAt: now
  };
  await saveNavigationCategory(env, category);
  await saveNavigationCategoryIndex(env, [...ids, category.id]);
  await saveNavigationLinkIndex(env, category.id, []);
  return category;
}

async function reorderNavigationCategories(env: Env, ids: string[]): Promise<NavigationCategoryRecord[]> {
  await saveNavigationCategoryIndex(env, ids);
  const now = new Date().toISOString();
  const categories = await Promise.all(
    ids.map(async (id, index) => {
      const category = await getNavigationCategory(env, id);
      if (!category) {
        return null;
      }
      return saveNavigationCategory(env, {
        ...category,
        sortOrder: index,
        updatedAt: now
      });
    })
  );
  return categories.filter((category): category is NavigationCategoryRecord => Boolean(category));
}

async function deleteNavigationCategory(env: Env, categoryId: string): Promise<void> {
  const linkIds = await getNavigationLinkIndex(env, categoryId);
  await Promise.all(linkIds.map((id) => env.APP_KV.delete(`nav:link:${id}`)));
  await env.APP_KV.delete(`nav:link:index:${categoryId}`);
  await env.APP_KV.delete(`nav:category:${categoryId}`);

  const nextIds = (await getNavigationCategoryIndex(env)).filter((id) => id !== categoryId);
  await reorderNavigationCategories(env, nextIds);
}

async function getNavigationLink(env: Env, id: string): Promise<NavigationLinkRecord | null> {
  const link = await env.APP_KV.get(`nav:link:${id}`, 'json');
  if (!link) {
    return null;
  }

  const record = link as Partial<NavigationLinkRecord>;
  return {
    id: record.id ?? id,
    categoryId: record.categoryId ?? '',
    title: record.title ?? '',
    url: record.url ?? '',
    description: record.description ?? '',
    sortOrder: record.sortOrder ?? 0,
    visitCount: record.visitCount ?? 0,
    lastVisitedAt: record.lastVisitedAt ?? null,
    createdAt: record.createdAt ?? new Date(0).toISOString(),
    updatedAt: record.updatedAt ?? new Date(0).toISOString()
  };
}

async function getNavigationLinkIndex(env: Env, categoryId: string): Promise<string[]> {
  return (await env.APP_KV.get(`nav:link:index:${categoryId}`, 'json')) ?? [];
}

async function saveNavigationLinkIndex(env: Env, categoryId: string, ids: string[]): Promise<void> {
  await env.APP_KV.put(`nav:link:index:${categoryId}`, JSON.stringify(ids));
}

async function saveNavigationLink(env: Env, link: NavigationLinkRecord): Promise<NavigationLinkRecord> {
  await env.APP_KV.put(`nav:link:${link.id}`, JSON.stringify(link));
  return link;
}

async function getNavigationLinksByCategory(env: Env, categoryId: string): Promise<NavigationLinkRecord[]> {
  const ids = await getNavigationLinkIndex(env, categoryId);
  const links = await Promise.all(ids.map((id) => getNavigationLink(env, id)));
  return links.filter((link): link is NavigationLinkRecord => Boolean(link)).sort((a, b) => a.sortOrder - b.sortOrder);
}

async function createNavigationLink(
  env: Env,
  payload: Pick<NavigationLinkRecord, 'categoryId' | 'title' | 'url' | 'description'>
): Promise<NavigationLinkRecord> {
  const ids = await getNavigationLinkIndex(env, payload.categoryId);
  const now = new Date().toISOString();
  const link: NavigationLinkRecord = {
    id: randomToken(8),
    categoryId: payload.categoryId,
    title: payload.title,
    url: payload.url,
    description: payload.description,
    sortOrder: ids.length,
    visitCount: 0,
    lastVisitedAt: null,
    createdAt: now,
    updatedAt: now
  };
  await saveNavigationLink(env, link);
  await saveNavigationLinkIndex(env, payload.categoryId, [...ids, link.id]);
  return link;
}

async function reorderNavigationLinks(env: Env, categoryId: string, ids: string[]): Promise<NavigationLinkRecord[]> {
  await saveNavigationLinkIndex(env, categoryId, ids);
  const now = new Date().toISOString();
  const links = await Promise.all(
    ids.map(async (id, index) => {
      const link = await getNavigationLink(env, id);
      if (!link) {
        return null;
      }
      return saveNavigationLink(env, {
        ...link,
        categoryId,
        sortOrder: index,
        updatedAt: now
      });
    })
  );
  return links.filter((link): link is NavigationLinkRecord => Boolean(link));
}

async function updateNavigationLink(
  env: Env,
  link: NavigationLinkRecord,
  payload: Pick<NavigationLinkRecord, 'categoryId' | 'title' | 'url' | 'description'>
): Promise<NavigationLinkRecord> {
  const now = new Date().toISOString();
  if (payload.categoryId === link.categoryId) {
    const updated = await saveNavigationLink(env, {
      ...link,
      title: payload.title,
      url: payload.url,
      description: payload.description,
      updatedAt: now
    });
    return updated;
  }

  const sourceIds = (await getNavigationLinkIndex(env, link.categoryId)).filter((id) => id !== link.id);
  await reorderNavigationLinks(env, link.categoryId, sourceIds);

  const targetIds = await getNavigationLinkIndex(env, payload.categoryId);
  const updated: NavigationLinkRecord = {
    ...link,
    categoryId: payload.categoryId,
    title: payload.title,
    url: payload.url,
    description: payload.description,
    sortOrder: targetIds.length,
    updatedAt: now
  };
  await saveNavigationLink(env, updated);
  await saveNavigationLinkIndex(env, payload.categoryId, [...targetIds, updated.id]);
  return updated;
}

async function deleteNavigationLink(env: Env, linkId: string, categoryId: string): Promise<void> {
  await env.APP_KV.delete(`nav:link:${linkId}`);
  const nextIds = (await getNavigationLinkIndex(env, categoryId)).filter((id) => id !== linkId);
  await reorderNavigationLinks(env, categoryId, nextIds);
}

async function recordNavigationLinkVisit(env: Env, link: NavigationLinkRecord): Promise<NavigationLinkRecord> {
  const updated: NavigationLinkRecord = {
    ...link,
    visitCount: (link.visitCount ?? 0) + 1,
    lastVisitedAt: new Date().toISOString()
  };
  return saveNavigationLink(env, updated);
}

async function getNoteIndex(env: Env): Promise<string[]> {
  return (await env.APP_KV.get(APP_KEYS.noteIndex, 'json')) ?? [];
}

async function saveNoteIndex(env: Env, ids: string[]): Promise<void> {
  await env.APP_KV.put(APP_KEYS.noteIndex, JSON.stringify(ids));
}

async function getNoteRecord(env: Env, id: string): Promise<NoteRecord | null> {
  const note = await env.APP_KV.get(`note:${id}`, 'json');
  return note as NoteRecord | null;
}

async function saveNoteRecord(env: Env, note: NoteRecord): Promise<NoteRecord> {
  await env.APP_KV.put(`note:${note.id}`, JSON.stringify(note));
  return note;
}

async function createNoteRecord(env: Env, title: string, content: string): Promise<NoteRecord> {
  const ids = await getNoteIndex(env);
  const now = new Date().toISOString();
  const note: NoteRecord = {
    id: randomToken(8),
    title,
    content,
    isPinned: false,
    createdAt: now,
    updatedAt: now
  };
  await saveNoteRecord(env, note);
  await saveNoteIndex(env, [...ids, note.id]);
  return note;
}

async function deleteNoteRecord(env: Env, id: string): Promise<void> {
  const ids = await getNoteIndex(env);
  await env.APP_KV.delete(`note:${id}`);
  await saveNoteIndex(
    env,
    ids.filter((value) => value !== id)
  );
}

async function getAllNotes(env: Env): Promise<NoteRecord[]> {
  const ids = await getNoteIndex(env);
  const notes = await Promise.all(ids.map((id) => getNoteRecord(env, id)));
  return notes
    .filter((note): note is NoteRecord => Boolean(note))
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt));
}

async function getSnippetIndex(env: Env): Promise<string[]> {
  return (await env.APP_KV.get(APP_KEYS.snippetIndex, 'json')) ?? [];
}

async function saveSnippetIndex(env: Env, ids: string[]): Promise<void> {
  await env.APP_KV.put(APP_KEYS.snippetIndex, JSON.stringify(ids));
}

async function getSnippetRecord(env: Env, id: string): Promise<SnippetRecord | null> {
  const snippet = await env.APP_KV.get(`snippet:${id}`, 'json');
  return snippet as SnippetRecord | null;
}

async function saveSnippetRecord(env: Env, snippet: SnippetRecord): Promise<SnippetRecord> {
  await env.APP_KV.put(`snippet:${snippet.id}`, JSON.stringify(snippet));
  return snippet;
}

async function createSnippetRecord(
  env: Env,
  payload: Pick<SnippetRecord, 'type' | 'title' | 'content'>
): Promise<SnippetRecord> {
  const ids = await getSnippetIndex(env);
  const now = new Date().toISOString();
  const snippet: SnippetRecord = {
    id: randomToken(8),
    type: payload.type,
    title: payload.title,
    content: payload.content,
    isPinned: false,
    createdAt: now,
    updatedAt: now
  };
  await saveSnippetRecord(env, snippet);
  await saveSnippetIndex(env, [...ids, snippet.id]);
  return snippet;
}

async function deleteSnippetRecord(env: Env, id: string): Promise<void> {
  const ids = await getSnippetIndex(env);
  await env.APP_KV.delete(`snippet:${id}`);
  await saveSnippetIndex(
    env,
    ids.filter((value) => value !== id)
  );
}

async function getAllSnippets(
  env: Env,
  options?: {
    type?: SnippetType;
    query?: string;
  }
): Promise<SnippetRecord[]> {
  const ids = await getSnippetIndex(env);
  const snippets = (await Promise.all(ids.map((id) => getSnippetRecord(env, id))))
    .filter((snippet): snippet is SnippetRecord => Boolean(snippet))
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt));

  return snippets.filter((snippet) => {
    if (options?.type && snippet.type !== options.type) {
      return false;
    }
    if (options?.query) {
      const needle = options.query.toLowerCase();
      return snippet.title.toLowerCase().includes(needle) || snippet.content.toLowerCase().includes(needle);
    }
    return true;
  });
}

function getMaxLogEntries(env: Env): number {
  return Number.parseInt(env.MAX_LOG_ENTRIES ?? '200', 10);
}

function getAggregateTtlSeconds(env: Env): number {
  return Number.parseInt(env.AGGREGATE_TTL_SECONDS ?? '3600', 10);
}

function getHttpsOrigin(request: Request): string {
  const url = new URL(request.url);
  return `https://${url.host}`;
}

function getClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp;
  }
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) {
    return null;
  }
  for (const pair of cookieHeader.split(';')) {
    const [key, value] = pair.trim().split('=');
    if (key === name) {
      return decodeURIComponent(value || '');
    }
  }
  return null;
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function isSafeNavigationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSnippetType(value: string | null | undefined): value is SnippetType {
  return value === 'text' || value === 'code' || value === 'link' || value === 'image';
}

function getDefaultSnippetTitle(type: SnippetType): string {
  const map: Record<SnippetType, string> = {
    text: '文本片段',
    code: '代码片段',
    link: '链接片段',
    image: '图片片段'
  };
  return map[type];
}

function getByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    path?: string;
    httpOnly?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    secure?: boolean;
    maxAge?: number;
  }
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) parts.push(`Path=${options.path}`);
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function randomToken(byteLength = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (part) => part.toString(16).padStart(2, '0')).join('');
}
