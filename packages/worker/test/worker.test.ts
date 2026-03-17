import { beforeEach, describe, expect, it } from 'vitest';
import { app, type Env } from '../src/index';

class MemoryKv {
  private store = new Map<string, string>();

  async get(key: string, type?: 'text' | 'json') {
    const value = this.store.get(key);
    if (!value) {
      return null;
    }
    if (type === 'json') {
      return JSON.parse(value);
    }
    return value;
  }

  async put(key: string, value: string) {
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

async function login(env: Env): Promise<string> {
  const response = await app.request(
    'https://example.com/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
      headers: { 'content-type': 'application/json' }
    },
    env
  );
  return response.headers.get('set-cookie') || '';
}

describe('worker behaviors', () => {
  let env: Env;

  beforeEach(async () => {
    env = {
      APP_KV: new MemoryKv() as unknown as KVNamespace,
      CACHE_KV: new MemoryKv() as unknown as KVNamespace,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: await sha256Hex('secret'),
      SUB_TOKEN: 'token-123',
      AGGREGATE_TTL_SECONDS: '3600',
      MAX_LOG_ENTRIES: '200'
    };
  });

  it('redirects plain http requests to https', async () => {
    const response = await app.request('http://example.com/health', undefined, env);
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://example.com/health');
  });

  it('keeps sub endpoint protected by token', async () => {
    const response = await app.request('https://example.com/sub?bad-token', undefined, env);
    expect(response.status).toBe(401);
  });

  it('returns https links from sub info', async () => {
    const cookie = await login(env);
    expect(cookie).toBeTruthy();

    const response = await app.request(
      'https://example.com/api/sub/info',
      {
        headers: { cookie: cookie || '' }
      },
      env
    );
    const data = (await response.json()) as { formats: Array<{ url: string }> };
    expect(response.status).toBe(200);
    expect(data.formats.every((format) => format.url.startsWith('https://'))).toBe(true);
  });

  it('reorders sources through the dedicated route', async () => {
    const cookie = await login(env);

    const createSource = async (name: string) =>
      app.request(
        'https://example.com/api/sources',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie
          },
          body: JSON.stringify({
            name,
            content: 'vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8iLCJuZXQiOiJ3cyIsInR5cGUiOiJub25lIiwiaG9zdCI6ImV4YW1wbGUuY29tIiwicGF0aCI6Ii8iLCJ0bHMiOiJ0bHMiLCJzbmkiOiJleGFtcGxlLmNvbSJ9'
          })
        },
        env
      );

    const firstResponse = await createSource('源 A');
    const secondResponse = await createSource('源 B');
    const firstData = (await firstResponse.json()) as { source: { id: string } };
    const secondData = (await secondResponse.json()) as { source: { id: string } };

    const reorderResponse = await app.request(
      'https://example.com/api/sources/reorder',
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({ ids: [secondData.source.id, firstData.source.id] })
      },
      env
    );

    expect(reorderResponse.status).toBe(200);

    const listResponse = await app.request(
      'https://example.com/api/sources',
      {
        headers: { cookie }
      },
      env
    );
    const listData = (await listResponse.json()) as { sources: Array<{ id: string }> };
    expect(listData.sources.map((source) => source.id)).toEqual([secondData.source.id, firstData.source.id]);
  });

  it('seeds navigation categories and links', async () => {
    const cookie = await login(env);
    const response = await app.request(
      'https://example.com/api/navigation',
      {
        headers: { cookie }
      },
      env
    );

    const data = (await response.json()) as { categories: Array<{ name: string; links: Array<{ title: string }> }> };
    expect(response.status).toBe(200);
    expect(data.categories.length).toBeGreaterThan(0);
    expect(data.categories[0].links.length).toBeGreaterThan(0);
  });

  it('records navigation link visits', async () => {
    const cookie = await login(env);
    const navResponse = await app.request(
      'https://example.com/api/navigation',
      {
        headers: { cookie }
      },
      env
    );
    const navData = (await navResponse.json()) as { categories: Array<{ links: Array<{ id: string }> }> };
    const linkId = navData.categories[0]?.links[0]?.id;
    expect(linkId).toBeTruthy();

    const visitResponse = await app.request(
      `https://example.com/api/navigation/links/${linkId}/visit`,
      {
        method: 'POST',
        headers: { cookie }
      },
      env
    );

    const visitData = (await visitResponse.json()) as { visitCount: number; lastVisitedAt: string | null };
    expect(visitResponse.status).toBe(200);
    expect(visitData.visitCount).toBe(1);
    expect(visitData.lastVisitedAt).toBeTruthy();
  });

  it('creates and updates notes', async () => {
    const cookie = await login(env);

    const createResponse = await app.request(
      'https://example.com/api/notes',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({ title: '测试笔记', content: '# hello' })
      },
      env
    );
    const createData = (await createResponse.json()) as { note: { id: string; title: string } };
    expect(createResponse.status).toBe(200);

    const updateResponse = await app.request(
      `https://example.com/api/notes/${createData.note.id}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({ isPinned: true })
      },
      env
    );

    const updateData = (await updateResponse.json()) as { note: { isPinned: boolean } };
    expect(updateData.note.isPinned).toBe(true);
  });

  it('creates and filters snippets', async () => {
    const cookie = await login(env);

    await app.request(
      'https://example.com/api/snippets',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({ type: 'code', title: 'Deploy', content: 'wrangler deploy' })
      },
      env
    );

    const response = await app.request(
      'https://example.com/api/snippets?type=code&q=deploy',
      {
        headers: { cookie }
      },
      env
    );

    const data = (await response.json()) as { snippets: Array<{ title: string; type: string }> };
    expect(response.status).toBe(200);
    expect(data.snippets).toHaveLength(1);
    expect(data.snippets[0].type).toBe('code');
  });
});
