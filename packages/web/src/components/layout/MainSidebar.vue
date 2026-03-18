<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useUiStore, type SecondaryNavItem } from '../../stores/ui';
import { APP_NAV_ITEMS } from './nav';

const uiStore = useUiStore();
const router = useRouter();

const props = defineProps<{
  currentPath: string;
  secondaryItems: SecondaryNavItem[];
  secondaryActiveKey: string;
}>();

const emit = defineEmits<{
  selectSecondary: [item: SecondaryNavItem];
}>();

function isCurrent(itemTo: string) {
  return props.currentPath.startsWith(itemTo);
}

async function handlePrimaryClick(itemTo: string) {
  if (isCurrent(itemTo) && props.secondaryItems.length) {
    uiStore.toggleSidebarSection(itemTo);
    return;
  }

  if (!isCurrent(itemTo)) {
    await router.push(itemTo);
  }
}
</script>

<template>
  <aside class="main-sidebar">
    <div class="sidebar-brand">
      <img src="/logo.png" alt="QianKui" class="sidebar-logo" />
      <div>
        <p class="eyebrow">Control Center</p>
        <strong>QianKui</strong>
      </div>
    </div>

    <nav class="sidebar-nav">
      <div v-for="item in APP_NAV_ITEMS" :key="item.to" class="sidebar-group">
        <button class="sidebar-link sidebar-link-button" :class="{ 'sidebar-link-active': isCurrent(item.to) }" @click="handlePrimaryClick(item.to)">
          <div class="sidebar-link-copy">
            <span>{{ item.label }}</span>
            <small>{{ item.caption }}</small>
          </div>
          <span v-if="isCurrent(item.to) && secondaryItems.length" class="sidebar-link-chevron">
            {{ uiStore.expandedSidebarSection === item.to ? '▾' : '▸' }}
          </span>
        </button>

        <div
          v-if="isCurrent(item.to) && secondaryItems.length && uiStore.expandedSidebarSection === item.to"
          class="sidebar-submenu"
        >
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
      </div>
    </nav>
  </aside>
</template>
