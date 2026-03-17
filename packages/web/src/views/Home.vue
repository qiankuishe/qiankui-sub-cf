<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import QRCode from 'qrcode';
import { authApi, logsApi, sourcesApi, type Source, type ValidationResult } from '../api';
import { useAppStore } from '../stores/app';

const router = useRouter();
const store = useAppStore();

const dialogVisible = ref(false);
const editingSource = ref<Source | null>(null);
const formName = ref('');
const formContent = ref('');
const validation = ref<ValidationResult | null>(null);
const validating = ref(false);
const errorMessage = ref('');
const qrDialogVisible = ref(false);
const qrTitle = ref('');
const qrCodeUrl = ref('');
const toastMessage = ref('');
const deleteTarget = ref<Source | null>(null);
let validateTimer: number | undefined;
let toastTimer: number | undefined;

const dialogTitle = computed(() => (editingSource.value ? '编辑订阅源' : '新增订阅源'));
const cacheStatusText = computed(() => {
  if (!store.subInfo) {
    return '未加载';
  }
  const statusMap: Record<string, string> = {
    fresh: '缓存有效',
    stale: '缓存较旧',
    missing: '未生成缓存'
  };
  return statusMap[store.subInfo.cacheStatus] || store.subInfo.cacheStatus;
});

onMounted(() => {
  void store.loadAll();
});

watch(formContent, () => {
  if (validateTimer) {
    window.clearTimeout(validateTimer);
  }
  validateTimer = window.setTimeout(() => {
    void validateCurrentInput();
  }, 300);
});

async function validateCurrentInput() {
  if (!formContent.value.trim()) {
    validation.value = null;
    return;
  }
  validating.value = true;
  try {
    validation.value = await sourcesApi.validate(formContent.value);
  } catch (error) {
    validation.value = null;
    errorMessage.value = error instanceof Error ? error.message : '校验失败';
  } finally {
    validating.value = false;
  }
}

function openCreateDialog() {
  editingSource.value = null;
  formName.value = '';
  formContent.value = '';
  validation.value = null;
  errorMessage.value = '';
  dialogVisible.value = true;
}

function openEditDialog(source: Source) {
  editingSource.value = source;
  formName.value = source.name;
  formContent.value = source.content;
  validation.value = null;
  errorMessage.value = '';
  dialogVisible.value = true;
}

async function saveSource() {
  if (!formName.value.trim() || !formContent.value.trim()) {
    errorMessage.value = '名称和内容都不能为空';
    return;
  }

  errorMessage.value = '';
  try {
    if (editingSource.value) {
      await store.updateSource(editingSource.value.id, {
        name: formName.value.trim(),
        content: formContent.value.trim()
      });
    } else {
      await store.createSource(formName.value.trim(), formContent.value.trim());
    }
    dialogVisible.value = false;
    await store.loadAll();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存失败';
  }
}

function removeSource(source: Source) {
  deleteTarget.value = source;
}

async function moveSource(source: Source, direction: -1 | 1) {
  const list = [...store.sources];
  const index = list.findIndex((item) => item.id === source.id);
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= list.length) {
    return;
  }
  const [item] = list.splice(index, 1);
  list.splice(targetIndex, 0, item);
  await store.reorderSources(list.map((entry) => entry.id));
}

async function copyLink(url: string) {
  await navigator.clipboard.writeText(url);
  showToast('复制成功');
}

async function showQr(name: string, url: string) {
  qrTitle.value = name;
  qrCodeUrl.value = await QRCode.toDataURL(url, { width: 260, margin: 1 });
  qrDialogVisible.value = true;
}

function shortenUrl(url: string, maxLength = 54) {
  if (url.length <= maxLength) {
    return url;
  }
  return `${url.slice(0, maxLength)}...`;
}

function formatDateTime(value: string | undefined, fallback = '尚未刷新') {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

async function logout() {
  await authApi.logout().catch(() => undefined);
  await router.push('/login');
}

async function refreshLogs() {
  const data = await logsApi.getRecent(50);
  store.logs = data.logs;
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

async function confirmDelete() {
  if (!deleteTarget.value) {
    return;
  }
  await store.deleteSource(deleteTarget.value.id);
  await store.loadAll();
  deleteTarget.value = null;
  showToast('订阅源已删除');
}
</script>

<template>
  <div class="dashboard-page">
    <transition name="toast-fade">
      <div v-if="toastMessage" class="top-toast">
        {{ toastMessage }}
      </div>
    </transition>

    <header class="app-header">
      <div class="brand-block">
        <img src="/logo.png" alt="QianKui" class="brand-logo" />
        <div>
          <p class="eyebrow">Workers + KV</p>
          <h1>QianKui 聚合</h1>
          <p class="subtitle">订阅聚合、缓存刷新与 Cloudflare 后台</p>
        </div>
      </div>

      <div class="header-actions">
        <button class="ghost" @click="store.toggleDarkMode">{{ store.darkMode ? '浅色模式' : '深色模式' }}</button>
        <button class="ghost" @click="store.refreshAggregation" :disabled="store.refreshing">
          {{ store.refreshing ? '刷新中...' : '刷新聚合缓存' }}
        </button>
        <button class="ghost" @click="logout">退出登录</button>
      </div>
    </header>

    <main class="dashboard-stack">
      <section class="panel">
        <div class="section-head">
          <div>
            <h2>订阅链接</h2>
            <p class="section-subtitle">所有展示链接都固定为 HTTPS，客户端可直接订阅。</p>
          </div>
          <div class="status-pill" :data-status="store.subInfo?.cacheStatus || 'missing'">
            {{ cacheStatusText }}
          </div>
        </div>

        <div class="meta-grid">
          <div class="metric-card">
            <span>总节点数</span>
            <strong>{{ store.subInfo?.totalNodes ?? 0 }}</strong>
          </div>
          <div class="metric-card">
            <span>最近刷新</span>
            <strong>{{ formatDateTime(store.subInfo?.lastRefreshTime, '尚未刷新') }}</strong>
          </div>
          <div class="metric-card">
            <span>Warning</span>
            <strong>{{ store.subInfo?.warningCount ?? 0 }}</strong>
          </div>
          <div class="metric-card">
            <span>最近保存</span>
            <strong>{{ formatDateTime(store.lastSaveTime, '尚未保存') }}</strong>
          </div>
        </div>

        <p v-if="store.subInfo?.lastRefreshError" class="error-banner">
          {{ store.subInfo.lastRefreshError }}
        </p>

        <div class="link-list">
          <article v-for="format in store.subFormats" :key="format.key" class="link-item">
            <div>
              <h3>{{ format.name }}</h3>
              <p :title="format.url">{{ shortenUrl(format.url) }}</p>
            </div>
            <div class="link-actions">
              <button class="ghost small" @click="copyLink(format.url)">复制</button>
              <button class="ghost small" @click="showQr(format.name, format.url)">二维码</button>
            </div>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <h2>订阅源管理</h2>
            <p class="section-subtitle">支持订阅 URL 与节点 URI 混合输入，可随时重新排序。</p>
          </div>
          <button class="primary" @click="openCreateDialog">新增订阅源</button>
        </div>

        <div v-if="store.sources.length === 0" class="empty-state">
          还没有订阅源，先添加一条开始吧。
        </div>

        <div v-else class="source-list">
          <article v-for="source in store.sources" :key="source.id" class="source-card">
            <div class="source-main">
              <h3>{{ source.name }}</h3>
              <p>{{ source.nodeCount }} 条节点 · 更新于 {{ formatDateTime(source.updatedAt) }}</p>
            </div>
            <div class="source-actions">
              <button class="ghost small" @click="moveSource(source, -1)">上移</button>
              <button class="ghost small" @click="moveSource(source, 1)">下移</button>
              <button class="ghost small" @click="openEditDialog(source)">编辑</button>
              <button class="ghost danger small" @click="removeSource(source)">删除</button>
            </div>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <h2>运行日志</h2>
            <p class="section-subtitle">查看登录、刷新缓存和订阅请求的最近记录。</p>
          </div>
          <button class="ghost" @click="refreshLogs">刷新日志</button>
        </div>

        <div v-if="store.logs.length === 0" class="empty-state">暂无日志。</div>
        <div v-else class="log-list">
          <article v-for="log in store.logs" :key="log.id" class="log-item">
            <div class="log-head">
              <strong>{{ log.action }}</strong>
              <span>{{ formatDateTime(log.createdAt) }}</span>
            </div>
            <p>{{ log.detail || '无详情' }}</p>
          </article>
        </div>
      </section>
    </main>

    <div v-if="dialogVisible" class="modal-backdrop" @click.self="dialogVisible = false">
      <div class="modal-card">
        <div class="section-head">
          <div>
            <h2>{{ dialogTitle }}</h2>
            <p class="section-subtitle">支持混合输入订阅链接与单条节点 URI。</p>
          </div>
          <button class="ghost small" @click="dialogVisible = false">关闭</button>
        </div>

        <label class="field">
          <span>备注名称</span>
          <input v-model="formName" placeholder="例如：机场主订阅" />
        </label>

        <label class="field">
          <span>订阅内容</span>
          <textarea v-model="formContent" rows="10" placeholder="粘贴订阅链接、节点 URI 或混合输入"></textarea>
        </label>

        <div class="validation-box">
          <template v-if="validating">正在校验输入...</template>
          <template v-else-if="validation">
            <strong>校验结果</strong>
            <p>订阅链接 {{ validation.urlCount }} 个，原始节点 {{ validation.totalCount }} 条，去重后 {{ validation.nodeCount }} 条。</p>
            <p v-if="validation.duplicateCount > 0">发现重复节点 {{ validation.duplicateCount }} 条。</p>
            <ul v-if="validation.warnings.length">
              <li v-for="item in validation.warnings.slice(0, 5)" :key="`${item.code}-${item.message}`">
                {{ item.message }}
              </li>
            </ul>
          </template>
          <template v-else>输入后会自动执行校验。</template>
        </div>

        <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>

        <div class="dialog-actions">
          <button class="ghost" @click="dialogVisible = false">取消</button>
          <button class="primary" @click="saveSource" :disabled="store.saving">
            {{ store.saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="qrDialogVisible" class="modal-backdrop" @click.self="qrDialogVisible = false">
      <div class="modal-card qr-card">
        <div class="section-head">
          <div>
            <h2>{{ qrTitle }}</h2>
            <p class="section-subtitle">扫码后即可导入订阅。</p>
          </div>
          <button class="ghost small" @click="qrDialogVisible = false">关闭</button>
        </div>
        <img :src="qrCodeUrl" alt="QRCode" class="qr-image" />
      </div>
    </div>

    <div v-if="deleteTarget" class="modal-backdrop" @click.self="deleteTarget = null">
      <div class="modal-card confirm-card">
        <div class="section-head">
          <div>
            <h2>确认删除</h2>
            <p class="section-subtitle">删除后需要重新添加订阅源才能恢复。</p>
          </div>
          <button class="ghost small" @click="deleteTarget = null">关闭</button>
        </div>
        <p class="confirm-text">确定删除「{{ deleteTarget.name }}」吗？</p>
        <div class="dialog-actions">
          <button class="ghost" @click="deleteTarget = null">取消</button>
          <button class="primary danger-fill" @click="confirmDelete">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>
