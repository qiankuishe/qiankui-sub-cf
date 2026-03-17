<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { nextTick } from 'vue';
import { useRoute } from 'vue-router';
import type { SnippetRecord, SnippetType } from '../../api';
import { useSnippetsStore } from '../../stores/snippets';
import { useUiStore } from '../../stores/ui';
import { formatDateTime } from '../../utils/date';

const snippetsStore = useSnippetsStore();
const uiStore = useUiStore();
const route = useRoute();

const searchQuery = ref('');
const filterType = ref<SnippetType | 'all'>('all');
const dialogVisible = ref(false);
const editingSnippet = ref<SnippetRecord | null>(null);
const deleteTarget = ref<SnippetRecord | null>(null);
const formType = ref<SnippetType>('text');
const formTitle = ref('');
const formContent = ref('');
const errorMessage = ref('');
const highlightedSnippetId = ref<string | null>(null);
let searchTimer: number | undefined;

const filteredLabel = computed(() => (filterType.value === 'all' ? '全部' : filterType.value));

watch([searchQuery, filterType], () => {
  if (searchTimer) {
    window.clearTimeout(searchTimer);
  }
  searchTimer = window.setTimeout(() => {
    void snippetsStore.loadAll({ type: filterType.value, q: searchQuery.value });
  }, 250);
});

onMounted(() => {
  if (typeof route.query.q === 'string') {
    searchQuery.value = route.query.q;
  }
  if (typeof route.query.type === 'string' && ['all', 'text', 'code', 'link', 'image'].includes(route.query.type)) {
    filterType.value = route.query.type as SnippetType | 'all';
  }
  void snippetsStore.loadAll({ type: filterType.value, q: searchQuery.value });
});

watch(
  () => [route.query.focus, snippetsStore.snippets] as const,
  async ([focusId]) => {
    if (typeof focusId !== 'string' || !focusId || !snippetsStore.snippets.some((snippet) => snippet.id === focusId)) {
      return;
    }
    highlightedSnippetId.value = focusId;
    await nextTick();
    document.querySelector(`[data-snippet-id="${focusId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.setTimeout(() => {
      if (highlightedSnippetId.value === focusId) {
        highlightedSnippetId.value = null;
      }
    }, 2200);
  },
  { deep: true, immediate: true }
);

function openDialog(snippet?: SnippetRecord) {
  editingSnippet.value = snippet ?? null;
  formType.value = snippet?.type ?? 'text';
  formTitle.value = snippet?.title ?? '';
  formContent.value = snippet?.content ?? '';
  errorMessage.value = '';
  dialogVisible.value = true;
}

async function saveSnippet() {
  if (!formTitle.value.trim()) {
    errorMessage.value = '标题不能为空';
    return;
  }

  try {
    if (editingSnippet.value) {
      await snippetsStore.updateSnippet(editingSnippet.value.id, {
        type: formType.value,
        title: formTitle.value.trim(),
        content: formContent.value
      });
      uiStore.showToast('片段已更新');
    } else {
      await snippetsStore.createSnippet({
        type: formType.value,
        title: formTitle.value.trim(),
        content: formContent.value
      });
      uiStore.showToast('片段已创建');
    }
    dialogVisible.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存片段失败';
  }
}

async function togglePin(snippet: SnippetRecord) {
  await snippetsStore.updateSnippet(snippet.id, { isPinned: !snippet.isPinned });
  uiStore.showToast(snippet.isPinned ? '已取消置顶' : '已置顶');
}

async function copySnippet(snippet: SnippetRecord) {
  if (snippet.type === 'image' && snippet.content.startsWith('data:')) {
    try {
      const response = await fetch(snippet.content);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      uiStore.showToast('图片已复制');
      return;
    } catch {
      // fallback to copying raw content
    }
  }
  await navigator.clipboard.writeText(snippet.content);
  uiStore.showToast('已复制');
}

async function confirmDelete() {
  if (!deleteTarget.value) {
    return;
  }
  await snippetsStore.deleteSnippet(deleteTarget.value.id);
  deleteTarget.value = null;
  uiStore.showToast('片段已删除');
}

function handleImageUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    formContent.value = String(reader.result ?? '');
  };
  reader.readAsDataURL(file);
}
</script>

<template>
  <div class="page-shell page-shell-wide">
    <section class="panel">
      <div class="section-head">
        <div>
          <h2>片段库</h2>
          <p class="section-subtitle">把文本、代码、链接和小图片沉淀成长期可搜索的资料片段。</p>
        </div>
        <button class="primary" @click="openDialog()">新建片段</button>
      </div>

      <div class="snippet-toolbar">
        <label class="field snippet-search">
          <span>搜索</span>
          <input v-model="searchQuery" placeholder="搜索标题或内容" />
        </label>

        <label class="field snippet-filter">
          <span>类型</span>
          <select v-model="filterType" class="field-select">
            <option value="all">全部</option>
            <option value="text">文本</option>
            <option value="code">代码</option>
            <option value="link">链接</option>
            <option value="image">图片</option>
          </select>
        </label>
      </div>

      <div class="meta-grid">
        <div class="metric-card">
          <span>当前类型</span>
          <strong>{{ filteredLabel }}</strong>
        </div>
        <div class="metric-card">
          <span>结果数量</span>
          <strong>{{ snippetsStore.snippets.length }}</strong>
        </div>
      </div>

      <div v-if="snippetsStore.snippets.length === 0" class="empty-state">当前筛选下还没有片段。</div>
      <div v-else class="snippet-grid">
        <article
          v-for="snippet in snippetsStore.snippets"
          :key="snippet.id"
          :data-snippet-id="snippet.id"
          class="snippet-card"
          :class="{ 'search-highlight': snippet.id === highlightedSnippetId }"
        >
          <div class="snippet-card-head">
            <div>
              <h3>{{ snippet.title }}</h3>
              <p>{{ snippet.type }} · {{ formatDateTime(snippet.updatedAt, '未保存') }}</p>
            </div>
            <span v-if="snippet.isPinned" class="note-pin-badge">置顶</span>
          </div>

          <div v-if="snippet.type === 'image' && snippet.content" class="snippet-image-wrap">
            <img :src="snippet.content" alt="" class="snippet-image" />
          </div>
          <pre v-else-if="snippet.type === 'code'" class="snippet-code">{{ snippet.content }}</pre>
          <a v-else-if="snippet.type === 'link'" :href="snippet.content" target="_blank" rel="noreferrer" class="snippet-link">
            {{ snippet.content }}
          </a>
          <p v-else class="snippet-text">{{ snippet.content || '暂无内容' }}</p>

          <div class="nav-card-actions">
            <button class="ghost small" @click="copySnippet(snippet)">复制</button>
            <button class="ghost small" @click="togglePin(snippet)">
              {{ snippet.isPinned ? '取消置顶' : '置顶' }}
            </button>
            <button class="ghost small" @click="openDialog(snippet)">编辑</button>
            <button class="ghost danger small" @click="deleteTarget = snippet">删除</button>
          </div>
        </article>
      </div>
    </section>

    <div v-if="dialogVisible" class="modal-backdrop" @click.self="dialogVisible = false">
      <div class="modal-card">
        <div class="section-head">
          <div>
            <h2>{{ editingSnippet ? '编辑片段' : '新增片段' }}</h2>
            <p class="section-subtitle">首版重点优化快速录入、复制和按类型整理，不做公开分享。</p>
          </div>
        </div>

        <div class="editor-form">
          <label class="field">
            <span>片段类型</span>
            <select v-model="formType" class="field-select">
              <option value="text">文本</option>
              <option value="code">代码</option>
              <option value="link">链接</option>
              <option value="image">图片</option>
            </select>
          </label>

          <label class="field">
            <span>标题</span>
            <input v-model="formTitle" placeholder="例如：Cloudflare Route 模板" />
          </label>

          <label v-if="formType === 'image'" class="field">
            <span>上传图片</span>
            <input type="file" accept="image/*" @change="handleImageUpload" />
          </label>

          <label class="field">
            <span>内容</span>
            <textarea v-model="formContent" rows="10" :placeholder="formType === 'link' ? 'https://example.com' : '输入片段内容'"></textarea>
          </label>
        </div>

        <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>

        <div class="dialog-actions">
          <button class="ghost" @click="dialogVisible = false">取消</button>
          <button class="primary" :disabled="snippetsStore.saving" @click="saveSnippet">
            {{ snippetsStore.saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="deleteTarget" class="modal-backdrop" @click.self="deleteTarget = null">
      <div class="modal-card confirm-card">
        <div class="section-head">
          <div>
            <h2>确认删除片段</h2>
            <p class="section-subtitle">删除后该片段会从当前资料库中移除。</p>
          </div>
        </div>
        <p class="confirm-text">确定删除「{{ deleteTarget.title }}」吗？</p>
        <div class="dialog-actions">
          <button class="ghost" @click="deleteTarget = null">取消</button>
          <button class="primary danger-fill" :disabled="snippetsStore.saving" @click="confirmDelete">
            {{ snippetsStore.saving ? '删除中...' : '删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
