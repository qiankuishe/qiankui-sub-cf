import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface SecondaryNavItem {
  key: string;
  label: string;
  badge?: string;
  targetId?: string;
  to?: string;
}

export const useUiStore = defineStore('ui', () => {
  const darkMode = ref(localStorage.getItem('darkMode') === 'true');
  const toastMessage = ref('');
  const mobileNavOpen = ref(false);
  const secondaryNavTitle = ref('');
  const secondaryNavItems = ref<SecondaryNavItem[]>([]);
  const secondaryNavActiveKey = ref('');
  const expandedSidebarSection = ref('');
  let toastTimer: number | undefined;

  function applyTheme() {
    document.documentElement.classList.toggle('dark', darkMode.value);
  }

  function toggleDarkMode() {
    darkMode.value = !darkMode.value;
    localStorage.setItem('darkMode', String(darkMode.value));
    applyTheme();
  }

  function showToast(message: string) {
    toastMessage.value = message;
    if (toastTimer) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => {
      toastMessage.value = '';
    }, 1800);
  }

  function hideToast() {
    toastMessage.value = '';
  }

  function openMobileNav() {
    mobileNavOpen.value = true;
  }

  function closeMobileNav() {
    mobileNavOpen.value = false;
  }

  function setSecondaryNav(payload: { title?: string; items: SecondaryNavItem[]; activeKey?: string }) {
    secondaryNavTitle.value = payload.title ?? '';
    secondaryNavItems.value = payload.items;
    secondaryNavActiveKey.value = payload.activeKey ?? payload.items[0]?.key ?? '';
  }

  function setSecondaryNavActive(key: string) {
    secondaryNavActiveKey.value = key;
  }

  function clearSecondaryNav() {
    secondaryNavTitle.value = '';
    secondaryNavItems.value = [];
    secondaryNavActiveKey.value = '';
  }

  function toggleSidebarSection(section: string) {
    expandedSidebarSection.value = expandedSidebarSection.value === section ? '' : section;
  }

  function expandSidebarSection(section: string) {
    expandedSidebarSection.value = section;
  }

  applyTheme();

  return {
    darkMode,
    toastMessage,
    mobileNavOpen,
    secondaryNavTitle,
    secondaryNavItems,
    secondaryNavActiveKey,
    expandedSidebarSection,
    toggleDarkMode,
    showToast,
    hideToast,
    openMobileNav,
    closeMobileNav,
    setSecondaryNav,
    setSecondaryNavActive,
    clearSecondaryNav,
    toggleSidebarSection,
    expandSidebarSection
  };
});
