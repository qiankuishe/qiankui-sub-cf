<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
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
const draftType = ref<SnippetType>('text');
const draftTitle = ref('');
const draftContent = ref('');
const draftError = ref('');
const highlightedSnippetId = ref<string | null>(null);
const clipboardBusy = ref<'idle' | 'text' | 'image' | 'draft' | 'editor'>('idle');
const expandedSnippetIds = ref<string[]>([]);
const draftTitleInput = ref<HTMLInputElement | null>(null);

const captureSectionId = 'clipboard-capture';
const typeOptions: Array<{ key: SnippetType; label: string }> = [
  { key: 'text', label: '文本' },
  { key: 'code', label: '代码' },
  { key: 'link', label: '链接' },
  { key: 'image', label: '图片' }
];

const totalCount = computed(() => snippetsStore.snippets.length);
const pinnedCount = computed(() => snippetsStore.snippets.filter((snippet) => snippet.isPinned).length);
const updatedTodayCount = computed(() =>
  snippetsStore.snippets.filter((snippet) => isSameLocalDay(snippet.updatedAt, new Date())).length
);
const typeCounts = computed<Record<SnippetType, number>>(() => ({
  text: snippetsStore.snippets.filter((snippet) => snippet.type === 'text').length,
  code: snippetsStore.snippets.filter((snippet) => snippet.type === 'code').length,
  link: snippetsStore.snippets.filter((snippet) => snippet.type === 'link').length,
  image: snippetsStore.snippets.filter((snippet) => snippet.type === 'image').length
}));
const filteredSnippets = computed(() => {
  const needle = searchQuery.value.trim().toLowerCase();
  return snippetsStore.snippets.filter((snippet) => {
    if (filterType.value !== 'all' && snippet.type !== filterType.value) {
      return false;
    }
    if (!needle) {
      return true;
    }

    const haystacks = [snippet.title.toLowerCase()];
    if (snippet.type === 'image') {
      haystacks.push('图片');
    } else {
      haystacks.push(snippet.content.toLowerCase());
    }
    return haystacks.some((value) => value.includes(needle));
  });
});
const filteredCount = computed(() => filteredSnippets.value.length);
const pinnedSnippets = computed(() => filteredSnippets.value.filter((snippet) => snippet.isPinned));
const recentSnippets = computed(() => filteredSnippets.value.filter((snippet) => !snippet.isPinned));
const filteredLabel = computed(() => (filterType.value === 'all' ? '全部内容' : getSnippetTypeLabel(filterType.value)));
const draftMetaText = computed(() =>
  draftType.value === 'image'
    ? draftContent.value
      ? formatBytes(getByteLength(draftContent.value))
      : '未选择图片'
    : `${draftContent.value.trim().length} 字`
);
const editorMetaText = computed(() =>
  formType.value === 'image'
    ? formContent.value
      ? formatBytes(getByteLength(formContent.value))
      : '未选择图片'
    : `${formContent.value.trim().length} 字`
);
const emptyMessage = computed(() => {
  if (snippetsStore.loading) {
    return '正在加载剪贴内容...';
  }
  if (!totalCount.value) {
    return '还没有保存任何剪贴内容，先从系统剪贴板抓一条吧。';
  }
  if (searchQuery.value.trim()) {
    return '没有找到匹配的剪贴内容，换个关键词试试。';
  }
  return '当前筛选下还没有内容。';
});

watch(
  () => [filterType.value, totalCount.value, pinnedCount.value, typeCounts.value.text, typeCounts.value.code, typeCounts.value.link, typeCounts.value.image],
  ([activeType]) => {
    uiStore.setSecondaryNav({
      title: '剪贴板',
      activeKey: String(activeType),
      items: [
        { key: 'all', label: '全部', badge: String(totalCount.value), to: '/app/snippets' },
        { key: 'text', label: '文本', badge: String(typeCounts.value.text), to: '/app/snippets?type=text' },
        { key: 'code', label: '代码', badge: String(typeCounts.value.code), to: '/app/snippets?type=code' },
        { key: 'link', label: '链接', badge: String(typeCounts.value.link), to: '/app/snippets?type=link' },
        { key: 'image', label: '图片', badge: String(typeCounts.value.image), to: '/app/snippets?type=image' }
      ]
    });
  },
  { immediate: true }
);

watch(
  () => route.query.type,
  (value) => {
    if (typeof value === 'string' && ['text', 'code', 'link', 'image'].includes(value)) {
      filterType.value = value as SnippetType;
      return;
    }
    if (!value) {
      filterType.value = 'all';
    }
  },
  { immediate: true }
);

watch(
  () => [route.query.focus, snippetsStore.snippets] as const,
  async ([focusId]) => {
    const target =
      typeof focusId === 'string' && focusId ? snippetsStore.snippets.find((snippet) => snippet.id === focusId) ?? null : null;
    if (!target) {
      return;
    }

    searchQuery.value = '';
    filterType.value = 'all';
    highlightedSnippetId.value = target.id;
    await nextTick();
    document.querySelector(`[data-snippet-id="${target.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.setTimeout(() => {
      if (highlightedSnippetId.value === target.id) {
        highlightedSnippetId.value = null;
      }
    }, 2200);
  },
  { deep: true, immediate: true }
);

onMounted(async () => {
  if (typeof route.query.q === 'string') {
    searchQuery.value = route.query.q;
  }
  if (typeof route.query.type === 'string' && ['all', 'text', 'code', 'link', 'image'].includes(route.query.type)) {
    filterType.value = route.query.type as SnippetType | 'all';
  }
  await snippetsStore.loadAll({ type: 'all' });
});

onUnmounted(() => {
  uiStore.clearSecondaryNav();
});

function getSnippetTypeLabel(type: SnippetType) {
  return typeOptions.find((option) => option.key === type)?.label ?? type;
}

function getSnippetTypeClass(type: SnippetType) {
  return `clipboard-type-${type}`;
}

function isSameLocalDay(value: string, reference: Date) {
  const date = new Date(value);
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

function getByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function looksLikeCode(value: string) {
  const sample = value.trim();
  return /```|^\s*(const|let|var|function|import|export|class)\b|[{};]{2,}|<\/?[a-z][\s\S]*>/m.test(sample);
}

function detectSnippetType(value: string): SnippetType {
  if (isHttpUrl(value.trim())) {
    return 'link';
  }
  if (looksLikeCode(value)) {
    return 'code';
  }
  return 'text';
}

function buildSuggestedTitle(type: SnippetType, content: string) {
  if (type === 'link') {
    try {
      return new URL(content).host.replace(/^www\./, '');
    } catch {
      return '剪贴链接';
    }
  }
  if (type === 'image') {
    return '剪贴图片';
  }

  const firstLine = content
    .trim()
    .split(/\r?\n/)[0]
    ?.replace(/\s+/g, ' ')
    .trim();
  if (firstLine) {
    return firstLine.slice(0, 24);
  }
  return type === 'code' ? '剪贴代码' : '剪贴文本';
}

function validateSnippet(type: SnippetType, content: string) {
  if (type === 'image') {
    return content ? '' : '请先添加图片';
  }
  const trimmed = content.trim();
  if (!trimmed) {
    return '内容不能为空';
  }
  if (type === 'link' && !isHttpUrl(trimmed)) {
    return '链接内容需要以 http:// 或 https:// 开头';
  }
  return '';
}

function normalizeSnippetContent(type: SnippetType, content: string) {
  return type === 'link' ? content.trim() : content;
}

function focusComposer() {
  document.getElementById(captureSectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => {
    draftTitleInput.value?.focus();
  }, 180);
}

function resetDraft() {
  draftType.value = 'text';
  draftTitle.value = '';
  draftContent.value = '';
  draftError.value = '';
}

function openDialog(snippet: SnippetRecord) {
  editingSnippet.value = snippet;
  formType.value = snippet.type;
  formTitle.value = snippet.title;
  formContent.value = snippet.content;
  errorMessage.value = '';
  dialogVisible.value = true;
}

function toggleExpand(id: string) {
  if (expandedSnippetIds.value.includes(id)) {
    expandedSnippetIds.value = expandedSnippetIds.value.filter((value) => value !== id);
    return;
  }
  expandedSnippetIds.value = [...expandedSnippetIds.value, id];
}

function isSnippetExpanded(id: string) {
  return expandedSnippetIds.value.includes(id);
}

function isSnippetExpandable(snippet: SnippetRecord) {
  if (snippet.type === 'image' || snippet.type === 'link') {
    return false;
  }
  return snippet.content.length > 220 || snippet.content.split(/\r?\n/).length > 6;
}

function getSnippetExcerpt(snippet: SnippetRecord) {
  const excerpt = snippet.content
    .split(/\r?\n/)
    .slice(0, 6)
    .join('\n')
    .slice(0, 220)
    .trimEnd();
  return excerpt.length < snippet.content.trimEnd().length ? `${excerpt}...` : excerpt;
}

function getSnippetDisplayContent(snippet: SnippetRecord) {
  if (!isSnippetExpandable(snippet) || isSnippetExpanded(snippet.id)) {
    return snippet.content;
  }
  return getSnippetExcerpt(snippet);
}

function getSnippetMeta(snippet: SnippetRecord) {
  if (snippet.type === 'image') {
    return formatBytes(getByteLength(snippet.content));
  }
  if (snippet.type === 'link') {
    try {
      return new URL(snippet.content).host;
    } catch {
      return '未识别链接';
    }
  }
  if (snippet.type === 'code') {
    return `${snippet.content.split(/\r?\n/).length} 行`;
  }
  return `${snippet.content.trim().length} 字`;
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

async function readClipboardPayload(preferred: 'text' | 'image' | 'any' = 'any') {
  if (!navigator.clipboard) {
    throw new Error('当前环境不支持读取系统剪贴板');
  }

  if (preferred !== 'text' && 'read' in navigator.clipboard) {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        return {
          type: 'image' as const,
          content: await blobToDataUrl(blob)
        };
      }

      if (preferred === 'any' && item.types.includes('text/plain')) {
        const blob = await item.getType('text/plain');
        const text = await blob.text();
        if (text.trim()) {
          return {
            type: detectSnippetType(text),
            content: text
          };
        }
      }
    }
  }

  if (preferred === 'image') {
    throw new Error('剪贴板里没有可读取的图片');
  }

  const text = await navigator.clipboard.readText();
  if (!text.trim()) {
    throw new Error('剪贴板里没有可读取的文本');
  }
  return {
    type: detectSnippetType(text),
    content: text
  };
}

async function applyImageToDraft(file: File) {
  if (!file.type.startsWith('image/')) {
    draftError.value = '请选择图片文件';
    return;
  }
  draftType.value = 'image';
  draftContent.value = await blobToDataUrl(file);
  draftError.value = '';
}

async function applyImageToEditor(file: File) {
  if (!file.type.startsWith('image/')) {
    errorMessage.value = '请选择图片文件';
    return;
  }
  formType.value = 'image';
  formContent.value = await blobToDataUrl(file);
  errorMessage.value = '';
}

async function createFromClipboard(preferred: 'text' | 'image') {
  clipboardBusy.value = preferred;
  try {
    const payload = await readClipboardPayload(preferred);
    const title = buildSuggestedTitle(payload.type, payload.content);
    await snippetsStore.createSnippet({
      type: payload.type,
      title,
      content: payload.content
    });
    uiStore.showToast(payload.type === 'image' ? '图片已加入剪贴板' : '内容已加入剪贴板');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '读取剪贴板失败');
  } finally {
    clipboardBusy.value = 'idle';
  }
}

async function fillDraftFromClipboard() {
  clipboardBusy.value = 'draft';
  draftError.value = '';
  try {
    const payload = await readClipboardPayload('any');
    draftType.value = payload.type;
    draftContent.value = payload.content;
    if (!draftTitle.value.trim()) {
      draftTitle.value = buildSuggestedTitle(payload.type, payload.content);
    }
    uiStore.showToast(payload.type === 'image' ? '已读取剪贴板图片' : '已读取剪贴板内容');
  } catch (error) {
    draftError.value = error instanceof Error ? error.message : '读取剪贴板失败';
  } finally {
    clipboardBusy.value = 'idle';
  }
}

async function fillEditorFromClipboard() {
  clipboardBusy.value = 'editor';
  errorMessage.value = '';
  try {
    const payload = await readClipboardPayload('any');
    formType.value = payload.type;
    formContent.value = payload.content;
    if (!formTitle.value.trim()) {
      formTitle.value = buildSuggestedTitle(payload.type, payload.content);
    }
    uiStore.showToast(payload.type === 'image' ? '已替换为剪贴板图片' : '已替换为剪贴板内容');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '读取剪贴板失败';
  } finally {
    clipboardBusy.value = 'idle';
  }
}

async function saveDraft() {
  const validationError = validateSnippet(draftType.value, draftContent.value);
  if (validationError) {
    draftError.value = validationError;
    return;
  }

  draftError.value = '';
  try {
    const content = normalizeSnippetContent(draftType.value, draftContent.value);
    await snippetsStore.createSnippet({
      type: draftType.value,
      title: draftTitle.value.trim() || buildSuggestedTitle(draftType.value, content),
      content
    });
    resetDraft();
    uiStore.showToast('已保存到剪贴板');
  } catch (error) {
    draftError.value = error instanceof Error ? error.message : '保存剪贴内容失败';
  }
}

async function saveSnippet() {
  if (!editingSnippet.value) {
    return;
  }

  const validationError = validateSnippet(formType.value, formContent.value);
  if (validationError) {
    errorMessage.value = validationError;
    return;
  }

  try {
    const content = normalizeSnippetContent(formType.value, formContent.value);
    await snippetsStore.updateSnippet(editingSnippet.value.id, {
      type: formType.value,
      title: formTitle.value.trim() || buildSuggestedTitle(formType.value, content),
      content
    });
    dialogVisible.value = false;
    uiStore.showToast('剪贴内容已更新');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存剪贴内容失败';
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
  uiStore.showToast('已复制到系统剪贴板');
}

function openSnippetLink(snippet: SnippetRecord) {
  if (snippet.type !== 'link' || !snippet.content.trim()) {
    return;
  }
  window.open(snippet.content, '_blank', 'noopener,noreferrer');
}

async function confirmDelete() {
  if (!deleteTarget.value) {
    return;
  }
  await snippetsStore.deleteSnippet(deleteTarget.value.id);
  deleteTarget.value = null;
  uiStore.showToast('剪贴内容已删除');
}

async function handleDraftImageUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }
  await applyImageToDraft(file);
}

async function handleEditorImageUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }
  await applyImageToEditor(file);
}
</script>

<template>
  <div class="page-shell page-shell-wide">
    <section class="panel clipboard-hero-panel">
      <div class="section-head clipboard-hero-head">
        <div class="clipboard-hero-copy">
          <p class="eyebrow">Clipboard Desk</p>
          <h2>剪贴板</h2>
          <p class="section-subtitle">把刚复制的文本、代码、链接和图片收进后台，后面一键复用。</p>
        </div>
        <div class="section-head-actions">
          <button class="ghost" :disabled="clipboardBusy !== 'idle'" @click="createFromClipboard('text')">
            {{ clipboardBusy === 'text' ? '读取中...' : '一键收文本' }}
          </button>
          <button class="ghost" :disabled="clipboardBusy !== 'idle'" @click="createFromClipboard('image')">
            {{ clipboardBusy === 'image' ? '读取中...' : '一键收图片' }}
          </button>
          <button class="primary" @click="focusComposer">手动整理</button>
        </div>
      </div>

      <div class="meta-grid clipboard-hero-grid">
        <div class="metric-card">
          <span>总内容数</span>
          <strong>{{ totalCount }}</strong>
        </div>
        <div class="metric-card">
          <span>置顶内容</span>
          <strong>{{ pinnedCount }}</strong>
        </div>
        <div class="metric-card">
          <span>今日更新</span>
          <strong>{{ updatedTodayCount }}</strong>
        </div>
        <div class="metric-card">
          <span>当前视图</span>
          <strong>{{ filteredLabel }}</strong>
        </div>
      </div>
    </section>

    <div class="clipboard-workspace">
      <section :id="captureSectionId" class="panel clipboard-compose-panel">
        <div class="section-head">
          <div>
            <h3>快速收集</h3>
            <p class="section-subtitle">先读入系统剪贴板，再补标题和类型。</p>
          </div>
        </div>

        <div class="clipboard-compose-actions">
          <button class="ghost small" :disabled="clipboardBusy !== 'idle'" @click="fillDraftFromClipboard">
            {{ clipboardBusy === 'draft' ? '读取中...' : '读取剪贴板' }}
          </button>
          <button class="ghost small" @click="resetDraft">清空草稿</button>
        </div>

        <div class="editor-form">
          <label class="field">
            <span>标题</span>
            <input ref="draftTitleInput" v-model="draftTitle" placeholder="默认会按内容自动命名" />
          </label>

          <div class="field">
            <span>类型</span>
            <div class="clipboard-type-grid">
              <button
                v-for="option in typeOptions"
                :key="option.key"
                type="button"
                class="clipboard-type-button"
                :class="[getSnippetTypeClass(option.key), { 'clipboard-type-button-active': draftType === option.key }]"
                @click="draftType = option.key"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <label v-if="draftType === 'image'" class="field">
            <span>上传图片</span>
            <input type="file" accept="image/*" @change="handleDraftImageUpload" />
          </label>

          <div v-if="draftType === 'image' && draftContent" class="clipboard-preview-card">
            <img :src="draftContent" alt="" class="snippet-image" />
          </div>

          <label class="field">
            <span>内容</span>
            <textarea
              v-model="draftContent"
              rows="12"
              :placeholder="draftType === 'link' ? 'https://example.com' : draftType === 'image' ? '可直接上传图片或读取剪贴板图片' : '输入或粘贴内容'"
            ></textarea>
          </label>
        </div>

        <div class="clipboard-compose-footer">
          <span class="inline-status">{{ draftMetaText }}</span>
          <button class="primary" :disabled="snippetsStore.saving" @click="saveDraft">
            {{ snippetsStore.saving ? '保存中...' : '保存到剪贴板' }}
          </button>
        </div>

        <p v-if="draftError" class="error-banner">{{ draftError }}</p>
      </section>

      <section class="panel clipboard-results-panel">
        <div class="section-head">
          <div>
            <h3>剪贴内容</h3>
            <p class="section-subtitle">支持检索、置顶、复制和再次编辑。</p>
          </div>
          <span class="inline-status">{{ filteredCount }} 项</span>
        </div>

        <div class="snippet-toolbar clipboard-toolbar">
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

        <div v-if="filteredCount === 0" class="empty-state">
          {{ emptyMessage }}
        </div>

        <template v-else>
          <section v-if="pinnedSnippets.length" class="clipboard-section">
            <div class="clipboard-section-head">
              <div>
                <h3>置顶内容</h3>
                <p class="section-subtitle">固定留在最前，适合常用模板和关键链接。</p>
              </div>
              <span class="inline-status">{{ pinnedSnippets.length }} 项</span>
            </div>

            <div class="snippet-grid">
              <article
                v-for="snippet in pinnedSnippets"
                :key="snippet.id"
                :data-snippet-id="snippet.id"
                :data-snippet-type="snippet.type"
                class="snippet-card clipboard-card"
                :class="{ 'search-highlight': snippet.id === highlightedSnippetId }"
              >
                <div class="snippet-card-head">
                  <div class="clipboard-card-title">
                    <h3>{{ snippet.title }}</h3>
                    <p>{{ getSnippetTypeLabel(snippet.type) }} · {{ formatDateTime(snippet.updatedAt, '未保存') }}</p>
                  </div>
                  <div class="clipboard-card-tags">
                    <span class="clipboard-type-badge" :class="getSnippetTypeClass(snippet.type)">{{ getSnippetTypeLabel(snippet.type) }}</span>
                    <span class="note-pin-badge">置顶</span>
                  </div>
                </div>

                <div v-if="snippet.type === 'image' && snippet.content" class="snippet-image-wrap">
                  <img :src="snippet.content" alt="" class="snippet-image" />
                </div>
                <a
                  v-else-if="snippet.type === 'link'"
                  :href="snippet.content"
                  target="_blank"
                  rel="noreferrer"
                  class="snippet-link clipboard-link"
                >
                  {{ snippet.content || '暂无链接' }}
                </a>
                <pre
                  v-else
                  class="clipboard-content-block"
                  :class="{ 'snippet-code': snippet.type === 'code', 'clipboard-text-block': snippet.type !== 'code' }"
                >{{ getSnippetDisplayContent(snippet) || '暂无内容' }}</pre>

                <div class="clipboard-card-meta">
                  <span>{{ getSnippetMeta(snippet) }}</span>
                  <button v-if="isSnippetExpandable(snippet)" class="ghost small" @click="toggleExpand(snippet.id)">
                    {{ isSnippetExpanded(snippet.id) ? '收起' : '展开' }}
                  </button>
                </div>

                <div class="nav-card-actions">
                  <button class="ghost small" @click="copySnippet(snippet)">复制</button>
                  <button v-if="snippet.type === 'link'" class="ghost small" @click="openSnippetLink(snippet)">打开</button>
                  <button class="ghost small" @click="togglePin(snippet)">
                    {{ snippet.isPinned ? '取消置顶' : '置顶' }}
                  </button>
                  <button class="ghost small" @click="openDialog(snippet)">编辑</button>
                  <button class="ghost danger small" @click="deleteTarget = snippet">删除</button>
                </div>
              </article>
            </div>
          </section>

          <section v-if="recentSnippets.length" class="clipboard-section">
            <div class="clipboard-section-head">
              <div>
                <h3>{{ pinnedSnippets.length ? '最近内容' : '全部内容' }}</h3>
                <p class="section-subtitle">按更新时间倒序排列，方便回看最近保存的剪贴内容。</p>
              </div>
              <span class="inline-status">{{ recentSnippets.length }} 项</span>
            </div>

            <div class="snippet-grid">
              <article
                v-for="snippet in recentSnippets"
                :key="snippet.id"
                :data-snippet-id="snippet.id"
                :data-snippet-type="snippet.type"
                class="snippet-card clipboard-card"
                :class="{ 'search-highlight': snippet.id === highlightedSnippetId }"
              >
                <div class="snippet-card-head">
                  <div class="clipboard-card-title">
                    <h3>{{ snippet.title }}</h3>
                    <p>{{ getSnippetTypeLabel(snippet.type) }} · {{ formatDateTime(snippet.updatedAt, '未保存') }}</p>
                  </div>
                  <div class="clipboard-card-tags">
                    <span class="clipboard-type-badge" :class="getSnippetTypeClass(snippet.type)">{{ getSnippetTypeLabel(snippet.type) }}</span>
                  </div>
                </div>

                <div v-if="snippet.type === 'image' && snippet.content" class="snippet-image-wrap">
                  <img :src="snippet.content" alt="" class="snippet-image" />
                </div>
                <a
                  v-else-if="snippet.type === 'link'"
                  :href="snippet.content"
                  target="_blank"
                  rel="noreferrer"
                  class="snippet-link clipboard-link"
                >
                  {{ snippet.content || '暂无链接' }}
                </a>
                <pre
                  v-else
                  class="clipboard-content-block"
                  :class="{ 'snippet-code': snippet.type === 'code', 'clipboard-text-block': snippet.type !== 'code' }"
                >{{ getSnippetDisplayContent(snippet) || '暂无内容' }}</pre>

                <div class="clipboard-card-meta">
                  <span>{{ getSnippetMeta(snippet) }}</span>
                  <button v-if="isSnippetExpandable(snippet)" class="ghost small" @click="toggleExpand(snippet.id)">
                    {{ isSnippetExpanded(snippet.id) ? '收起' : '展开' }}
                  </button>
                </div>

                <div class="nav-card-actions">
                  <button class="ghost small" @click="copySnippet(snippet)">复制</button>
                  <button v-if="snippet.type === 'link'" class="ghost small" @click="openSnippetLink(snippet)">打开</button>
                  <button class="ghost small" @click="togglePin(snippet)">
                    {{ snippet.isPinned ? '取消置顶' : '置顶' }}
                  </button>
                  <button class="ghost small" @click="openDialog(snippet)">编辑</button>
                  <button class="ghost danger small" @click="deleteTarget = snippet">删除</button>
                </div>
              </article>
            </div>
          </section>
        </template>
      </section>
    </div>

    <div v-if="dialogVisible" class="modal-backdrop" @click.self="dialogVisible = false">
      <div class="modal-card">
        <div class="section-head">
          <div>
            <h2>编辑剪贴内容</h2>
          </div>
          <button class="ghost small" :disabled="clipboardBusy !== 'idle'" @click="fillEditorFromClipboard">
            {{ clipboardBusy === 'editor' ? '读取中...' : '读入剪贴板' }}
          </button>
        </div>

        <div class="editor-form">
          <label class="field">
            <span>内容类型</span>
            <select v-model="formType" class="field-select">
              <option value="text">文本</option>
              <option value="code">代码</option>
              <option value="link">链接</option>
              <option value="image">图片</option>
            </select>
          </label>

          <label class="field">
            <span>标题</span>
            <input v-model="formTitle" placeholder="默认会按内容自动命名" />
          </label>

          <label v-if="formType === 'image'" class="field">
            <span>替换图片</span>
            <input type="file" accept="image/*" @change="handleEditorImageUpload" />
          </label>

          <div v-if="formType === 'image' && formContent" class="clipboard-preview-card">
            <img :src="formContent" alt="" class="snippet-image" />
          </div>

          <label class="field">
            <span>内容</span>
            <textarea
              v-model="formContent"
              rows="10"
              :placeholder="formType === 'link' ? 'https://example.com' : formType === 'image' ? '可直接上传图片或读取剪贴板图片' : '输入内容'"
            ></textarea>
          </label>
        </div>

        <div class="clipboard-compose-footer">
          <span class="inline-status">{{ editorMetaText }}</span>
        </div>

        <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>

        <div class="dialog-actions">
          <button class="ghost" @click="dialogVisible = false">取消</button>
          <button class="primary" :disabled="snippetsStore.saving" @click="saveSnippet">
            {{ snippetsStore.saving ? '保存中...' : '保存修改' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="deleteTarget" class="modal-backdrop" @click.self="deleteTarget = null">
      <div class="modal-card confirm-card">
        <div class="section-head">
          <div>
            <h2>确认删除剪贴内容</h2>
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
