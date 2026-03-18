export const DEFAULT_APP_ROUTE = '/app/nav';

const LAST_APP_ROUTE_KEY = 'qiankui:last-app-route';

export function isAppRoutePath(route: string | null | undefined): route is string {
  return typeof route === 'string' && route.startsWith('/app/');
}

export function readLastAppRoute(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_APP_ROUTE;
  }

  const stored = window.sessionStorage.getItem(LAST_APP_ROUTE_KEY);
  return isAppRoutePath(stored) ? stored : DEFAULT_APP_ROUTE;
}

export function rememberAppRoute(route: string) {
  if (typeof window === 'undefined' || !isAppRoutePath(route)) {
    return;
  }

  window.sessionStorage.setItem(LAST_APP_ROUTE_KEY, route);
}

export function resolveAppRoute(route: string | null | undefined): string {
  return isAppRoutePath(route) ? route : readLastAppRoute();
}

export function buildLoginRedirectUrl(route?: string): string {
  if (typeof window === 'undefined') {
    return '/login';
  }

  const currentRoute = route ?? `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (!isAppRoutePath(currentRoute)) {
    return '/login';
  }

  rememberAppRoute(currentRoute);
  return `/login?redirect=${encodeURIComponent(currentRoute)}`;
}
