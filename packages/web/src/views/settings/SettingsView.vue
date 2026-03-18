<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { authApi } from '../../api';
import { useUiStore } from '../../stores/ui';

const uiStore = useUiStore();
const router = useRouter();

const currentOrigin = computed(() => window.location.origin);

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
          <p class="section-subtitle">把外观、会话和系统信息放在同一页，侧边栏底部只保留快捷入口。</p>
        </div>
      </div>

      <div class="settings-grid">
        <article class="setting-card">
          <span>外观模式</span>
          <strong>{{ uiStore.darkMode ? '深色模式' : '浅色模式' }}</strong>
          <p>这里作为主题切换的正式入口，左侧底部按钮只做快速切换。</p>
          <button class="ghost small" @click="uiStore.toggleDarkMode">切换主题</button>
        </article>

        <article class="setting-card">
          <span>当前域名</span>
          <strong>{{ currentOrigin }}</strong>
          <p>订阅链接会跟随当前访问域名自动生成 HTTPS 地址。</p>
        </article>

        <article class="setting-card">
          <span>后台结构</span>
          <strong>6 个一级页面</strong>
          <p>网站导航、订阅聚合、笔记、片段库、运行日志和系统设置已经统一到同一套后台里。</p>
        </article>

        <article class="setting-card">
          <span>全局操作</span>
          <strong>退出当前会话</strong>
          <p>如果左侧底部按钮不方便使用，这里也可以安全退出登录。</p>
          <button class="ghost small danger" @click="logout">退出登录</button>
        </article>
      </div>
    </section>
  </div>
</template>
