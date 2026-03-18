<script setup lang="ts">
import type { SubInfo, SubFormat } from '../../../api';
import { formatDateTime } from '../../../utils/date';

defineProps<{
  subInfo: SubInfo | null;
  subFormats: SubFormat[];
  lastSaveTime: string;
  cacheStatusText: string;
  refreshing: boolean;
}>();

const emit = defineEmits<{
  copy: [url: string];
  qr: [name: string, url: string];
  refresh: [];
}>();

function shortenUrl(url: string, maxLength = 54) {
  if (url.length <= maxLength) {
    return url;
  }
  return `${url.slice(0, maxLength)}...`;
}
</script>

<template>
  <section class="panel compact-panel">
    <div class="section-head">
      <div>
        <h2>订阅链接</h2>
      </div>
      <div class="section-head-actions">
        <div class="status-pill" :data-status="subInfo?.cacheStatus || 'missing'">
          {{ cacheStatusText }}
        </div>
        <button class="ghost small" :disabled="refreshing" @click="emit('refresh')">
          {{ refreshing ? '刷新中...' : '刷新缓存' }}
        </button>
      </div>
    </div>

    <div class="meta-grid">
      <div class="metric-card">
        <span>总节点数</span>
        <strong>{{ subInfo?.totalNodes ?? 0 }}</strong>
      </div>
      <div class="metric-card">
        <span>最近刷新</span>
        <strong>{{ formatDateTime(subInfo?.lastRefreshTime, '尚未刷新') }}</strong>
      </div>
      <div class="metric-card">
        <span>Warning</span>
        <strong>{{ subInfo?.warningCount ?? 0 }}</strong>
      </div>
      <div class="metric-card">
        <span>最近保存</span>
        <strong>{{ formatDateTime(lastSaveTime, '尚未保存') }}</strong>
      </div>
    </div>

    <p v-if="subInfo?.lastRefreshError" class="error-banner">
      {{ subInfo.lastRefreshError }}
    </p>

    <div class="link-list">
      <article v-for="format in subFormats" :key="format.key" class="link-item">
        <div>
          <h3>{{ format.name }}</h3>
          <p :title="format.url">{{ shortenUrl(format.url) }}</p>
        </div>
        <div class="link-actions">
          <button class="ghost small" @click="emit('copy', format.url)">复制</button>
          <button class="ghost small" @click="emit('qr', format.name, format.url)">二维码</button>
        </div>
      </article>
    </div>
  </section>
</template>
