<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppTopbar from '../components/layout/AppTopbar.vue';
import MainSidebar from '../components/layout/MainSidebar.vue';
import MobileNavDrawer from '../components/layout/MobileNavDrawer.vue';
import { type SecondaryNavItem, useUiStore } from '../stores/ui';

const route = useRoute();
const router = useRouter();
const uiStore = useUiStore();

const title = computed(() => String(route.meta.title ?? 'QianKui'));
const subtitle = computed(() => String(route.meta.subtitle ?? ''));

watch(
  () => route.fullPath,
  () => {
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
