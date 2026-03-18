<script setup lang="ts">
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useNotesStore } from '../../stores/notes';
import { useUiStore } from '../../stores/ui';
import { formatDateTime } from '../../utils/date';

marked.setOptions({ breaks: true, gfm: true });

const notesStore = useNotesStore();
const uiStore = useUiStore();
const initialFocusId = new URLSearchParams(window.location.search).get('focus');

const selectedNoteId = ref<string | null>(null);
const editTitle = ref('');
const editContent = ref('');
const previewMode = ref(false);
const saveState = ref<'idle' | 'saving' | 'saved'>('idle');
const deleteTargetId = ref<string | null>(null);
const highlightedNoteId = ref<string | null>(null);
let initialFocusHandled = false;
let saveTimer: number | undefined;
let hydrating = false;

const selectedNote = computed(() => notesStore.notes.find((note) => note.id === selectedNoteId.value) ?? null);
const renderedPreview = computed(() => DOMPurify.sanitize(marked.parse(editContent.value) as string));

watch(
  () => notesStore.notes,
  (notes) => {
    if (!notes.length) {
      selectedNoteId.value = null;
      editTitle.value = '';
      editContent.value = '';
      return;
    }
    if (!selectedNoteId.value || !notes.some((note) => note.id === selectedNoteId.value)) {
      selectNote(notes[0].id);
    }
  },
  { deep: true, immediate: true }
);

watch(selectedNote, (note) => {
  hydrating = true;
  editTitle.value = note?.title ?? '';
  editContent.value = note?.content ?? '';
  nextTick(() => {
    hydrating = false;
  });
});

watch([editTitle, editContent], () => {
  if (!selectedNote.value || hydrating) {
    return;
  }
  queueSave();
});

onMounted(() => {
  uiStore.clearSecondaryNav();
  void notesStore.loadAll();
});

onUnmounted(() => {
  uiStore.clearSecondaryNav();
});

watch(
  () => notesStore.notes,
  async () => {
    if (initialFocusHandled || !initialFocusId || !notesStore.notes.some((note) => note.id === initialFocusId)) {
      return;
    }
    initialFocusHandled = true;
    selectNote(initialFocusId);
    highlightedNoteId.value = initialFocusId;
    await nextTick();
    document.querySelector(`[data-note-id="${initialFocusId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.setTimeout(() => {
      if (highlightedNoteId.value === initialFocusId) {
        highlightedNoteId.value = null;
      }
    }, 2200);
  },
  { deep: true, immediate: true }
);

function selectNote(id: string) {
  selectedNoteId.value = id;
}

async function createNote() {
  const note = await notesStore.createNote({ title: '新笔记', content: '' });
  selectedNoteId.value = note.id;
  previewMode.value = false;
  uiStore.showToast('已创建新笔记');
}

function queueSave() {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }
  saveState.value = 'saving';
  saveTimer = window.setTimeout(async () => {
    if (!selectedNote.value) {
      return;
    }
    try {
      const updated = await notesStore.updateNote(selectedNote.value.id, {
        title: editTitle.value.trim() || '无标题',
        content: editContent.value
      });
      selectedNoteId.value = updated.id;
      saveState.value = 'saved';
      window.setTimeout(() => {
        saveState.value = 'idle';
      }, 1200);
    } catch (error) {
      uiStore.showToast(error instanceof Error ? error.message : '自动保存失败');
      saveState.value = 'idle';
    }
  }, 600);
}

async function togglePin() {
  if (!selectedNote.value) {
    return;
  }
  await notesStore.updateNote(selectedNote.value.id, {
    isPinned: !selectedNote.value.isPinned
  });
  uiStore.showToast(selectedNote.value.isPinned ? '已取消置顶' : '已置顶');
}

async function confirmDelete() {
  if (!deleteTargetId.value) {
    return;
  }
  await notesStore.deleteNote(deleteTargetId.value);
  deleteTargetId.value = null;
  uiStore.showToast('笔记已删除');
}
</script>

<template>
  <div class="page-shell page-shell-wide">
    <div class="notes-layout">
      <section class="panel notes-sidebar-panel">
        <div class="section-head">
          <div>
            <h2>笔记列表</h2>
          </div>
          <button class="primary" @click="createNote">新建</button>
        </div>

        <div v-if="notesStore.notes.length === 0" class="empty-state">还没有笔记，先创建一条吧。</div>
        <div v-else class="notes-list">
          <button
            v-for="note in notesStore.notes"
            :key="note.id"
            :data-note-id="note.id"
            class="note-list-item"
            :class="{
              'note-list-item-active': note.id === selectedNoteId,
              'search-highlight': note.id === highlightedNoteId
            }"
            @click="selectNote(note.id)"
          >
            <div class="note-list-head">
              <strong>{{ note.title || '无标题' }}</strong>
              <span v-if="note.isPinned" class="note-pin-badge">置顶</span>
            </div>
            <p>{{ formatDateTime(note.updatedAt, '未保存') }}</p>
          </button>
        </div>
      </section>

      <section class="panel notes-editor-panel">
        <div v-if="!selectedNote" class="empty-state">请选择一条笔记开始编辑。</div>
        <template v-else>
          <div class="section-head">
            <div>
              <h2>{{ selectedNote.title || '无标题' }}</h2>
            </div>
            <div class="notes-toolbar">
              <span v-if="saveState === 'saving'" class="inline-status">保存中...</span>
              <span v-else-if="saveState === 'saved'" class="inline-status">已保存</span>
              <button class="ghost small" @click="previewMode = !previewMode">
                {{ previewMode ? '返回编辑' : '预览' }}
              </button>
              <button class="ghost small" @click="togglePin">
                {{ selectedNote.isPinned ? '取消置顶' : '置顶' }}
              </button>
              <button class="ghost danger small" @click="deleteTargetId = selectedNote.id">删除</button>
            </div>
          </div>

          <div class="editor-form">
            <label class="field">
              <span>标题</span>
              <input v-model="editTitle" placeholder="输入笔记标题" />
            </label>

            <div v-if="!previewMode" class="field">
              <span>内容</span>
              <textarea v-model="editContent" rows="18" placeholder="支持 Markdown 语法"></textarea>
            </div>

            <div v-else class="markdown-preview" v-html="renderedPreview"></div>
          </div>
        </template>
      </section>
    </div>

    <div v-if="deleteTargetId" class="modal-backdrop" @click.self="deleteTargetId = null">
      <div class="modal-card confirm-card">
        <div class="section-head">
          <div>
            <h2>确认删除笔记</h2>
          </div>
        </div>
        <p class="confirm-text">确定删除当前笔记吗？</p>
        <div class="dialog-actions">
          <button class="ghost" @click="deleteTargetId = null">取消</button>
          <button class="primary danger-fill" :disabled="notesStore.saving" @click="confirmDelete">
            {{ notesStore.saving ? '删除中...' : '删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
