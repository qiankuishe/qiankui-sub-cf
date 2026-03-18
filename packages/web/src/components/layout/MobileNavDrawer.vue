<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useUiStore, type SecondaryNavItem } from '../../stores/ui';
import { APP_NAV_ITEMS } from './nav';

const uiStore = useUiStore();

defineProps<{
  open: boolean;
  currentPath: string;
  secondaryTitle: string;
  secondaryItems: SecondaryNavItem[];
  secondaryActiveKey: string;
}>();

const emit = defineEmits<{
  close: [];
  selectSecondary: [item: SecondaryNavItem];
}>();
</script>

<template>
  <transition name="drawer-fade">
    <div v-if="open" class="mobile-drawer-backdrop" @click.self="emit('close')">
      <aside class="mobile-drawer">
        <div class="mobile-drawer-head">
          <div class="sidebar-brand">
            <img src="/logo.png" alt="QianKui" class="sidebar-logo" />
            <div>
              <p class="eyebrow">Control Center</p>
              <strong>QianKui</strong>
            </div>
          </div>
          <button class="ghost small" @click="emit('close')">收起</button>
        </div>

        <nav class="sidebar-nav">
          <div v-for="item in APP_NAV_ITEMS" :key="item.to" class="sidebar-group">
            <div class="sidebar-link-wrap">
              <RouterLink
                :to="item.to"
                class="sidebar-link"
                :class="{ 'sidebar-link-active': currentPath.startsWith(item.to) }"
                @click="emit('close')"
              >
                <span>{{ item.label }}</span>
                <small>{{ item.caption }}</small>
              </RouterLink>

              <button
                v-if="currentPath.startsWith(item.to) && secondaryItems.length"
                class="sidebar-expand-button"
                @click="uiStore.toggleSidebarSection(item.to)"
              >
                {{ uiStore.expandedSidebarSection === item.to ? '收起' : '展开' }}
              </button>
            </div>

            <section
              v-if="currentPath.startsWith(item.to) && secondaryItems.length && uiStore.expandedSidebarSection === item.to"
              class="mobile-secondary-nav"
            >
              <div class="mobile-secondary-nav-head">{{ secondaryTitle }}</div>
              <div class="mobile-secondary-nav-list">
                <button
                  v-for="subItem in secondaryItems"
                  :key="subItem.key"
                  class="sidebar-submenu-link"
                  :class="{ 'sidebar-submenu-link-active': secondaryActiveKey === subItem.key }"
                  @click="emit('selectSecondary', subItem)"
                >
                  <span>{{ subItem.label }}</span>
                  <small v-if="subItem.badge">{{ subItem.badge }}</small>
                </button>
              </div>
            </section>
          </div>
        </nav>
      </aside>
    </div>
  </transition>
</template>
