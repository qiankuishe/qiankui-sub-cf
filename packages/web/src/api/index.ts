export interface Source {
  id: string;
  name: string;
  content: string;
  nodeCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WarningItem {
  code: string;
  message: string;
  context?: string;
}

export interface ValidationResult {
  valid: boolean;
  urlCount: number;
  nodeCount: number;
  totalCount: number;
  duplicateCount: number;
  warnings: WarningItem[];
}

export interface SubFormat {
  name: string;
  key: string;
  url: string;
}

export interface SubInfo {
  formats: SubFormat[];
  totalNodes: number;
  lastAggregateTime: string;
  cacheStatus: string;
  lastRefreshTime: string;
  lastRefreshError: string;
  warningCount: number;
}

export interface LogRecord {
  id: string;
  action: string;
  detail: string | null;
  createdAt: string;
}

export interface NavigationLink {
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

export interface NavigationCategory {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  links: NavigationLink[];
}

export interface NoteRecord {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SnippetType = 'text' | 'code' | 'link' | 'image';

export interface SnippetRecord {
  id: string;
  type: SnippetType;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

async function request<T>(url: string, options?: RequestInit & { skipAuthRedirect?: boolean }): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers
  });

  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (response.status === 401 && !options?.skipAuthRedirect) {
    window.location.href = '/login';
  }
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }
  return data;
}

export const authApi = {
  login: (username: string, password: string) =>
    request<{ success: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      skipAuthRedirect: true
    }),
  logout: () =>
    request<{ success: boolean }>('/api/auth/logout', {
      method: 'POST'
    }),
  check: () => request<{ authenticated: boolean }>('/api/auth/check', { skipAuthRedirect: true })
};

export const sourcesApi = {
  getAll: () => request<{ sources: Source[]; lastSaveTime: string }>('/api/sources'),
  getById: (id: string) => request<Source>(`/api/sources/${id}`),
  validate: (content: string) =>
    request<ValidationResult>('/api/sources/validate', {
      method: 'POST',
      body: JSON.stringify({ content })
    }),
  create: (name: string, content: string) =>
    request<{ source: Source; lastSaveTime: string }>('/api/sources', {
      method: 'POST',
      body: JSON.stringify({ name, content })
    }),
  update: (id: string, data: { name?: string; content?: string }) =>
    request<{ source: Source; lastSaveTime: string }>(`/api/sources/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  delete: (id: string) =>
    request<{ success: boolean; lastSaveTime: string }>(`/api/sources/${id}`, {
      method: 'DELETE'
    }),
  reorder: (ids: string[]) =>
    request<{ success: boolean; lastSaveTime: string }>('/api/sources/reorder', {
      method: 'PUT',
      body: JSON.stringify({ ids })
    }),
  refresh: () =>
    request<{ sources: Source[]; lastSaveTime: string }>('/api/sources/refresh', {
      method: 'POST'
    })
};

export const subApi = {
  getInfo: () => request<SubInfo>('/api/sub/info')
};

export const logsApi = {
  getRecent: (limit = 50) => request<{ logs: LogRecord[] }>(`/api/logs?limit=${limit}`)
};

export const navigationApi = {
  getAll: () =>
    request<{ categories: NavigationCategory[]; totalCategories: number; totalLinks: number }>('/api/navigation'),
  createCategory: (name: string) =>
    request<{ category: NavigationCategory }>('/api/navigation/categories', {
      method: 'POST',
      body: JSON.stringify({ name })
    }),
  updateCategory: (id: string, data: { name: string }) =>
    request<{ category: NavigationCategory }>(`/api/navigation/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  deleteCategory: (id: string) =>
    request<{ success: boolean }>(`/api/navigation/categories/${id}`, {
      method: 'DELETE'
    }),
  reorderCategories: (ids: string[]) =>
    request<{ categories: NavigationCategory[] }>('/api/navigation/categories/reorder', {
      method: 'PUT',
      body: JSON.stringify({ ids })
    }),
  createLink: (payload: { categoryId: string; title: string; url: string; description?: string }) =>
    request<{ link: NavigationLink }>('/api/navigation/links', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  updateLink: (id: string, payload: { categoryId?: string; title?: string; url?: string; description?: string }) =>
    request<{ link: NavigationLink }>(`/api/navigation/links/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  deleteLink: (id: string) =>
    request<{ success: boolean }>(`/api/navigation/links/${id}`, {
      method: 'DELETE'
    }),
  recordVisit: (id: string) =>
    request<{ visitCount: number; lastVisitedAt: string | null }>(`/api/navigation/links/${id}/visit`, {
      method: 'POST'
    }),
  reorderLinks: (categoryId: string, ids: string[]) =>
    request<{ links: NavigationLink[] }>('/api/navigation/links/reorder', {
      method: 'PUT',
      body: JSON.stringify({ categoryId, ids })
    })
};

export const notesApi = {
  getAll: () => request<{ notes: NoteRecord[] }>('/api/notes'),
  create: (payload?: { title?: string; content?: string }) =>
    request<{ note: NoteRecord }>('/api/notes', {
      method: 'POST',
      body: JSON.stringify(payload ?? {})
    }),
  update: (id: string, payload: { title?: string; content?: string; isPinned?: boolean }) =>
    request<{ note: NoteRecord }>(`/api/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/notes/${id}`, {
      method: 'DELETE'
    })
};

export const snippetsApi = {
  getAll: (params?: { type?: SnippetType | 'all'; q?: string }) => {
    const search = new URLSearchParams();
    if (params?.type && params.type !== 'all') {
      search.set('type', params.type);
    }
    if (params?.q?.trim()) {
      search.set('q', params.q.trim());
    }
    const query = search.toString();
    return request<{ snippets: SnippetRecord[] }>(`/api/snippets${query ? `?${query}` : ''}`);
  },
  create: (payload: { type: SnippetType; title?: string; content?: string }) =>
    request<{ snippet: SnippetRecord }>('/api/snippets', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  update: (id: string, payload: { type?: SnippetType; title?: string; content?: string; isPinned?: boolean }) =>
    request<{ snippet: SnippetRecord }>(`/api/snippets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/snippets/${id}`, {
      method: 'DELETE'
    })
};
