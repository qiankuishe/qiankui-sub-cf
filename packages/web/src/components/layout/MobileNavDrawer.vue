<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useUiStore, type SecondaryNavItem } from '../../stores/ui';
import { restartCurrentSection } from '../../utils/localCacheReset';
import { APP_NAV_ITEMS } from './nav';

const uiStore = useUiStore();

const props = defineProps<{
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

const groupRefs = ref<Record<string, HTMLElement | null>>({});

function isCurrent(itemTo: string) {
  return props.currentPath.startsWith(itemTo);
}

function setGroupRef(itemTo: string, element: unknown) {
  groupRefs.value[itemTo] = element instanceof HTMLElement ? element : null;
}

async function revealGroup(itemTo: string) {
  await nextTick();
  groupRefs.value[itemTo]?.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest'
  });
}

async function handlePrimaryClick(itemTo: string) {
  if (isCurrent(itemTo) && props.secondaryItems.length) {
    uiStore.toggleSidebarSection(itemTo);
    if (uiStore.expandedSidebarSection === itemTo) {
      await revealGroup(itemTo);
    }
    return;
  }

  if (!isCurrent(itemTo)) {
    window.location.assign(itemTo);
  }

  emit('close');
}

function handleBrandClick() {
  restartCurrentSection();
}

watch(
  () => [props.currentPath, uiStore.expandedSidebarSection, props.secondaryItems.length, props.open],
  async ([currentPath, expandedSection, secondaryCount, open]) => {
    const path = String(currentPath);
    const section = String(expandedSection || '');
    const count = Number(secondaryCount);
    const drawerOpen = Boolean(open);
    if (!drawerOpen || !count || !section || !path.startsWith(section)) {
      return;
    }
    await revealGroup(section);
  }
);
</script>

<template>
  <transition name="drawer-fade">
    <div v-if="open" class="mobile-drawer-backdrop" @click.self="emit('close')">
      <aside class="mobile-drawer">
        <div class="mobile-drawer-head">
          <button class="sidebar-brand sidebar-brand-button" type="button" title="冷启动当前页面" @click="handleBrandClick">
            <img src="/logo.png" alt="QianKui" class="sidebar-logo" />
            <strong>QianKui</strong>
          </button>
          <button class="ghost small" @click="emit('close')">收起</button>
        </div>

        <nav class="sidebar-nav">
          <div
            v-for="item in APP_NAV_ITEMS"
            :key="item.to"
            :ref="(element) => setGroupRef(item.to, element)"
            class="sidebar-group"
          >
            <button class="sidebar-link sidebar-link-button" :class="{ 'sidebar-link-active': isCurrent(item.to) }" @click="handlePrimaryClick(item.to)">
              <div class="sidebar-link-copy">
                <span>{{ item.label }}</span>
              </div>
              <span v-if="isCurrent(item.to) && secondaryItems.length" class="sidebar-link-chevron">
                {{ uiStore.expandedSidebarSection === item.to ? '▾' : '▸' }}
              </span>
            </button>

            <section
              v-if="isCurrent(item.to) && secondaryItems.length && uiStore.expandedSidebarSection === item.to"
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
