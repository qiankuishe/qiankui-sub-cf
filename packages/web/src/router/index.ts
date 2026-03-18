import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { DEFAULT_APP_ROUTE, isAppRoutePath, readLastAppRoute, rememberAppRoute, resolveAppRoute } from '../utils/routeMemory';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: () => readLastAppRoute()
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/auth/LoginView.vue')
  },
  {
    path: '/app',
    component: () => import('../layouts/AppShell.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        redirect: () => readLastAppRoute()
      },
      {
        path: 'nav',
        name: 'navigation',
        component: () => import('../views/navigation/NavigationView.vue'),
        meta: {
          requiresAuth: true,
          title: '网站导航',
          subtitle: ''
        }
      },
      {
        path: 'subscriptions',
        name: 'subscriptions',
        component: () => import('../views/subscriptions/SubscriptionsView.vue'),
        meta: {
          requiresAuth: true,
          title: '订阅聚合',
          subtitle: ''
        }
      },
      {
        path: 'notes',
        name: 'notes',
        component: () => import('../views/notes/NotesView.vue'),
        meta: {
          requiresAuth: true,
          title: '笔记',
          subtitle: ''
        }
      },
      {
        path: 'snippets',
        name: 'snippets',
        component: () => import('../views/snippets/SnippetsView.vue'),
        meta: {
          requiresAuth: true,
          title: '片段库',
          subtitle: ''
        }
      },
      {
        path: 'logs',
        name: 'logs',
        component: () => import('../views/logs/LogsView.vue'),
        meta: {
          requiresAuth: true,
          title: '运行日志',
          subtitle: ''
        }
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('../views/settings/SettingsView.vue'),
        meta: {
          requiresAuth: true,
          title: '系统设置',
          subtitle: ''
        }
      }
    ]
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach(async (to) => {
  if (isAppRoutePath(to.fullPath)) {
    rememberAppRoute(to.fullPath);
  }

  if (to.path === '/login') {
    try {
      const response = await fetch('/api/auth/check', { credentials: 'include' });
      const data = (await response.json()) as { authenticated?: boolean };
      if (data.authenticated) {
        const redirect = typeof to.query.redirect === 'string' ? to.query.redirect : null;
        return resolveAppRoute(redirect);
      }
    } catch {
      // noop
    }

    return true;
  }

  if (!to.matched.some((record) => record.meta.requiresAuth)) {
    return true;
  }

  try {
    const response = await fetch('/api/auth/check', { credentials: 'include' });
    const data = (await response.json()) as { authenticated?: boolean };
    if (data.authenticated) {
      return true;
    }
  } catch {
    // noop
  }

  return {
    path: '/login',
    query: {
      redirect: isAppRoutePath(to.fullPath) ? to.fullPath : DEFAULT_APP_ROUTE
    }
  };
});

export default router;
