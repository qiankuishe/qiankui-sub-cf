<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppTopbar from '../components/layout/AppTopbar.vue';
import MainSidebar from '../components/layout/MainSidebar.vue';
import MobileNavDrawer from '../components/layout/MobileNavDrawer.vue';
import { type SecondaryNavItem, useUiStore } from '../stores/ui';
import { isAppRoutePath, readAppRouteScroll, rememberAppRouteScroll } from '../utils/routeMemory';

const route = useRoute();
const router = useRouter();
const uiStore = useUiStore();

const title = computed(() => String(route.meta.title ?? 'QianKui'));
const subtitle = computed(() => String(route.meta.subtitle ?? ''));
const RESTORE_SCROLL_WINDOW_MS = 5000;
let scrollFrame = 0;
let restoreRunId = 0;
let initialHistoryScrollRestoration: History['scrollRestoration'] | null = null;

function shouldRestoreScrollPosition(path = route.fullPath) {
  return isAppRoutePath(path) && !route.hash && typeof route.query.focus !== 'string';
}

function persistRouteScroll(path = route.fullPath) {
  if (!isAppRoutePath(path)) {
    return;
  }

  rememberAppRouteScroll(path, window.scrollY);
}

function handleWindowScroll() {
  if (scrollFrame) {
    return;
  }

  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = 0;
    persistRouteScroll();
  });
}

function handlePageHide() {
  persistRouteScroll();
}

function handlePageShow() {
  void restoreRouteScroll();
}

async function restoreRouteScroll(path = route.fullPath) {
  if (!isAppRoutePath(path)) {
    return;
  }

  const targetTop = readAppRouteScroll(path);
  if (targetTop <= 0 || !shouldRestoreScrollPosition(path)) {
    return;
  }

  const runId = ++restoreRunId;
  await nextTick();

  const startedAt = Date.now();
  const apply = () => {
    if (runId !== restoreRunId) {
      return;
    }

    const scrollingElement = document.scrollingElement ?? document.documentElement;
    const maxTop = Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
    const nextTop = Math.min(targetTop, maxTop);
    const distance = Math.abs(window.scrollY - nextTop);
    if (distance > 2) {
      window.scrollTo(0, nextTop);
    }

    const hasEnoughHeight = maxTop >= targetTop - 2;
    const restored = Math.abs(window.scrollY - nextTop) <= 2;
    if ((hasEnoughHeight && restored) || Date.now() - startedAt >= RESTORE_SCROLL_WINDOW_MS) {
      return;
    }

    window.setTimeout(apply, hasEnoughHeight ? 220 : 120);
  };

  apply();
}

watch(
  () => route.fullPath,
  (currentPath, previousPath) => {
    if (previousPath) {
      persistRouteScroll(previousPath);
    }

    uiStore.closeMobileNav();
    const matched = [route.path.startsWith('/app/snippets'), route.path.startsWith('/app/settings'), route.path.startsWith('/app/subscriptions'), route.path.startsWith('/app/nav')].some(Boolean);
    if (matched && uiStore.secondaryNavItems.length) {
      const section = route.path.startsWith('/app/nav')
        ? '/app/nav'
        : route.path.startsWith('/app/subscriptions')
          ? '/app/subscriptions'
          : route.path.startsWith('/app/snippets')
            ? '/app/snippets'
            : route.path.startsWith('/app/settings')
              ? '/app/settings'
              : '';
      if (section) {
        uiStore.expandSidebarSection(section);
      }
    }

    void restoreRouteScroll(currentPath);
  }
);

async function handleSecondarySelect(item: SecondaryNavItem) {
  uiStore.closeMobileNav();
  if (item.to) {
    await router.push(item.to);
    uiStore.setSecondaryNavActive(item.key);
    return;
  }

  if (item.targetId) {
    uiStore.setSecondaryNavActive(item.key);
    document.getElementById(item.targetId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
}

onMounted(() => {
  if ('scrollRestoration' in window.history) {
    initialHistoryScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
  }

  window.addEventListener('scroll', handleWindowScroll, { passive: true });
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
  void restoreRouteScroll();
});

onUnmounted(() => {
  persistRouteScroll();
  window.removeEventListener('scroll', handleWindowScroll);
  window.removeEventListener('pagehide', handlePageHide);
  if (scrollFrame) {
    window.cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }
  restoreRunId += 1;
  window.removeEventListener('pageshow', handlePageShow);
  if (initialHistoryScrollRestoration) {
    window.history.scrollRestoration = initialHistoryScrollRestoration;
  }
});
</script>

<template>
  <div class="app-shell">
    <transition name="toast-fade">
      <div v-if="uiStore.toastMessage" class="top-toast">
        {{ uiStore.toastMessage }}
      </div>
    </transition>

    <MainSidebar
      class="desktop-only"
      :current-path="route.path"
      :secondary-items="uiStore.secondaryNavItems"
      :secondary-active-key="uiStore.secondaryNavActiveKey"
      @select-secondary="handleSecondarySelect"
    />

    <div class="app-shell-main">
      <AppTopbar :title="title" :subtitle="subtitle" @menu="uiStore.openMobileNav" />

      <main class="page-content">
        <router-view />
      </main>
    </div>

    <MobileNavDrawer
      :open="uiStore.mobileNavOpen"
      :current-path="route.path"
      :secondary-title="uiStore.secondaryNavTitle || title"
      :secondary-items="uiStore.secondaryNavItems"
      :secondary-active-key="uiStore.secondaryNavActiveKey"
      @close="uiStore.closeMobileNav"
      @select-secondary="handleSecondarySelect"
    />
  </div>
</template>
