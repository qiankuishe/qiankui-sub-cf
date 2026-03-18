<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { authApi } from '../../api';
import { resolveAppRoute } from '../../utils/routeMemory';

const router = useRouter();
const route = useRoute();
const username = ref('');
const password = ref('');
const loading = ref(false);
const errorMessage = ref('');
const revealPassword = ref(false);

async function handleLogin() {
  if (!username.value.trim() || !password.value.trim()) {
    errorMessage.value = '请输入用户名和密码';
    return;
  }

  loading.value = true;
  errorMessage.value = '';
  try {
    await authApi.login(username.value.trim(), password.value);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null;
    await router.replace(resolveAppRoute(redirect));
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-hero">
        <img src="/logo.png" alt="QianKui" class="login-logo" />
        <div>
          <p class="eyebrow">Cloudflare Edition</p>
          <h1>QianKui 聚合</h1>
          <p class="subtitle">订阅聚合、导航扩展与统一后台入口</p>
        </div>
      </div>

      <form class="login-form" @submit.prevent="handleLogin">
        <label class="field">
          <span>用户名</span>
          <input v-model="username" autocomplete="username" placeholder="admin" />
        </label>

        <label class="field">
          <span>密码</span>
          <div class="password-field">
            <input
              v-model="password"
              :type="revealPassword ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="请输入密码"
            />
            <button
              type="button"
              class="password-toggle"
              :aria-label="revealPassword ? '隐藏密码' : '显示密码'"
              @click="revealPassword = !revealPassword"
            >
              <svg
                v-if="revealPassword"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3 3l18 18" />
                <path d="M10.58 10.58a2 2 0 102.84 2.84" />
                <path d="M9.88 5.09A9.77 9.77 0 0112 4.8c5.4 0 9.4 4.2 10.5 7.2a12.9 12.9 0 01-3.05 4.55" />
                <path d="M6.61 6.62C4.45 8.03 2.93 10.02 1.5 12c1.1 3 5.1 7.2 10.5 7.2 1.82 0 3.47-.48 4.91-1.25" />
              </svg>
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M1.5 12c1.1-3 5.1-7.2 10.5-7.2s9.4 4.2 10.5 7.2c-1.1 3-5.1 7.2-10.5 7.2S2.6 15 1.5 12z" />
                <circle cx="12" cy="12" r="3.2" />
              </svg>
            </button>
          </div>
        </label>

        <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>

        <button class="primary wide" type="submit" :disabled="loading">
          {{ loading ? '登录中...' : '登 录' }}
        </button>
      </form>
    </div>
  </div>
</template>
