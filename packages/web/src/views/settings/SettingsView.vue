<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { authApi } from '../../api';
import { useUiStore } from '../../stores/ui';

const uiStore = useUiStore();
const router = useRouter();

const currentOrigin = computed(() => window.location.origin);
const appearanceSectionId = 'settings-appearance';
const systemSectionId = 'settings-system';
const accountSectionId = 'settings-account';

onMounted(() => {
  uiStore.setSecondaryNav({
    title: '系统设置',
    activeKey: 'appearance',
    items: [
      { key: 'appearance', label: '外观', targetId: appearanceSectionId },
      { key: 'system', label: '系统', targetId: systemSectionId },
      { key: 'account', label: '账户', targetId: accountSectionId }
    ]
  });
});

onUnmounted(() => {
  uiStore.clearSecondaryNav();
});

async function logout() {
  await authApi.logout().catch(() => undefined);
  uiStore.showToast('已退出登录');
  await router.push('/login');
}
</script>

<template>
  <div class="page-shell page-shell-compact">
    <section class="panel compact-panel">
      <div class="section-head">
        <div>
          <h2>系统设置</h2>
        </div>
      </div>

      <div class="settings-grid">
        <article :id="appearanceSectionId" class="setting-card">
          <span>外观模式</span>
          <strong>{{ uiStore.darkMode ? '深色模式' : '浅色模式' }}</strong>
          <button class="ghost small" @click="uiStore.toggleDarkMode">切换主题</button>
        </article>

        <article :id="systemSectionId" class="setting-card">
          <span>当前域名</span>
          <strong>{{ currentOrigin }}</strong>
          <p>订阅链接会跟随当前访问域名自动生成 HTTPS 地址。</p>
        </article>

        <article class="setting-card">
          <span>后台结构</span>
          <strong>6 个一级页面</strong>
          <p>导航、订阅、笔记、片段、日志和设置共用一套后台框架。</p>
        </article>

        <article :id="accountSectionId" class="setting-card">
          <span>全局操作</span>
          <strong>退出当前会话</strong>
          <button class="ghost small danger" @click="logout">退出登录</button>
        </article>
      </div>
    </section>
  </div>
</template>
