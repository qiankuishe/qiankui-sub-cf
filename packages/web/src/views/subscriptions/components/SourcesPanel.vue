<script setup lang="ts">
import type { Source } from '../../../api';
import { formatDateTime } from '../../../utils/date';

defineProps<{
  sources: Source[];
  saving: boolean;
}>();

const emit = defineEmits<{
  create: [];
  edit: [source: Source];
  delete: [source: Source];
  move: [source: Source, direction: -1 | 1];
}>();

function isFirstSource(source: Source, sources: Source[]) {
  return sources[0]?.id === source.id;
}

function isLastSource(source: Source, sources: Source[]) {
  return sources.at(-1)?.id === source.id;
}
</script>

<template>
  <section class="panel compact-panel">
    <div class="section-head">
      <div>
        <h2>订阅源管理</h2>
      </div>
      <button class="primary" @click="emit('create')">新增订阅源</button>
    </div>

    <div v-if="sources.length === 0" class="empty-state">
      还没有订阅源，先添加一条开始吧。
    </div>

    <div v-else class="source-list">
      <article v-for="source in sources" :key="source.id" class="source-card">
        <div class="source-main">
          <h3>{{ source.name }}</h3>
          <p>{{ source.nodeCount }} 条节点 · 更新于 {{ formatDateTime(source.updatedAt) }}</p>
        </div>
        <div class="source-actions">
          <button class="ghost small" :disabled="saving || isFirstSource(source, sources)" @click="emit('move', source, -1)">上移</button>
          <button class="ghost small" :disabled="saving || isLastSource(source, sources)" @click="emit('move', source, 1)">下移</button>
          <button class="ghost small" :disabled="saving" @click="emit('edit', source)">编辑</button>
          <button class="ghost danger small" :disabled="saving" @click="emit('delete', source)">删除</button>
        </div>
      </article>
    </div>
  </section>
</template>
