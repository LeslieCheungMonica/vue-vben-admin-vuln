<script lang="ts" setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { Page } from '@vben/common-ui';
import { Descriptions, message, Tag } from 'ant-design-vue';
import { getCosmicTaskDetailApi, type CosmicApi } from '#/api/core/cosmic';

interface FlatNode {
  name: string;
  depth: number;
  path: string;
  evidence: CosmicApi.Evidence | undefined;
  hasChildren: boolean;
}

interface PartState {
  id: string;
  sessionId: string;
  type: 'reasoning' | 'tool' | 'step' | 'message';
  text: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: 'pending' | 'running' | 'completed';
  toolInput?: string;
  toolOutput?: string;
  stepType?: 'start' | 'finish';
  hidden?: boolean;
  hideContent?: boolean;
  updatedAt: number;
}

const route = useRoute();
const taskId = route.params.taskId as string;

const loading = ref(false);
const treeData = ref<CosmicApi.TaskDetailNode | null>(null);
const flatNodes = ref<FlatNode[]>([]);
const selectedEvidence = ref<CosmicApi.Evidence | null>(null);
const expandedPaths = ref<Set<string>>(new Set());

function flattenTree(node: CosmicApi.TaskDetailNode, depth: number, path: string): FlatNode[] {
  const currentPath = path ? `${path}-${node.name}` : node.name;
  const hasChildren = node.children && node.children.length > 0;
  const result: FlatNode[] = [];

  result.push({
    name: node.name,
    depth,
    path: currentPath,
    evidence: node.evidence,
    hasChildren,
  });

  if (hasChildren && expandedPaths.value.has(currentPath)) {
    for (const child of node.children!) {
      result.push(...flattenTree(child, depth + 1, currentPath));
    }
  }

  return result;
}

function rebuildFlatList() {
  if (!treeData.value) {
    flatNodes.value = [];
    return;
  }
  flatNodes.value = flattenTree(treeData.value, 0, '');
}

function toggleExpand(path: string) {
  if (expandedPaths.value.has(path)) {
    expandedPaths.value.delete(path);
  } else {
    expandedPaths.value.add(path);
  }
  expandedPaths.value = new Set(expandedPaths.value);
  rebuildFlatList();
}

const leftWidth = ref(70);
const rightCollapsed = ref(false);

function toggleRight() {
  rightCollapsed.value = !rightCollapsed.value;
}

const leftPanelStyle = computed(() => {
  if (rightCollapsed.value) return { width: '100%' };
  return { width: `${leftWidth.value}%` };
});

const rightPanelStyle = computed(() => {
  if (rightCollapsed.value) {
    return { width: '0', minWidth: '0', overflow: 'hidden', border: 'none' };
  }
  return { width: `calc(${100 - leftWidth.value}%)` };
});

async function fetchDetail() {
  loading.value = true;
  try {
    const res = await getCosmicTaskDetailApi(taskId);
    if (res.tree && res.tree.length > 0) {
      treeData.value = {
        name: 'COSMIC 功能判定',
        children: res.tree,
      };
      expandedPaths.value.add(treeData.value.name);
    } else {
      treeData.value = null;
    }
    rebuildFlatList();
  } catch {
    message.error('获取任务详情失败');
    treeData.value = null;
  } finally {
    loading.value = false;
  }
}

function selectEvidence(evidence: CosmicApi.Evidence | undefined) {
  if (evidence) selectedEvidence.value = evidence;
}

function countLeafNodes(node: CosmicApi.TaskDetailNode): number {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((sum, c) => sum + countLeafNodes(c), 0);
}

function countExists(node: CosmicApi.TaskDetailNode): number {
  if (!node.children || node.children.length === 0) {
    return node.evidence?.exists ? 1 : 0;
  }
  return node.children.reduce((sum, c) => sum + countExists(c), 0);
}

function countNotExists(node: CosmicApi.TaskDetailNode): number {
  if (!node.children || node.children.length === 0) {
    return node.evidence && !node.evidence.exists ? 1 : 0;
  }
  return node.children.reduce((sum, c) => sum + countNotExists(c), 0);
}

function countPending(node: CosmicApi.TaskDetailNode): number {
  if (!node.children || node.children.length === 0) {
    return !node.evidence ? 1 : 0;
  }
  return node.children.reduce((sum, c) => sum + countPending(c), 0);
}

// ---- Right side: thinking flow (EventSource) ----

const FLUSH_INTERVAL = 150;
const displayItems = shallowRef<PartState[]>([]);

const mergedDisplayItems = computed(() => {
  const result: (
    | { type: 'merged-reasoning'; texts: string[]; ids: string[] }
    | PartState
  )[] = [];
  let current: { type: 'merged-reasoning'; texts: string[]; ids: string[] } | null = null;

  for (const item of displayItems.value) {
    if (item.type === 'reasoning') {
      if (current) {
        current.texts.push(item.text);
        current.ids.push(item.id);
      } else {
        current = { type: 'merged-reasoning', texts: [item.text], ids: [item.id] };
        result.push(current);
      }
    } else {
      current = null;
      result.push(item);
    }
  }
  return result;
});

const eventStreamConnected = ref(false);
let eventSource: EventSource | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
const partsMap = new Map<string, PartState>();
const dirtyParts = new Set<string>();
const eventStreamContainer = ref<HTMLDivElement | null>(null);

function getOrCreatePart(id: string, sessionId: string, type: PartState['type']) {
  let part = partsMap.get(id);
  if (!part) {
    part = { id, sessionId, type, text: '', updatedAt: Date.now() };
    partsMap.set(id, part);
  }
  return part;
}

function flushDirtyParts() {
  if (dirtyParts.size === 0) return;
  const items = Array.from(partsMap.values())
    .filter((p) => !p.hidden)
    .sort((a, b) => a.updatedAt - b.updatedAt);
  displayItems.value = items;
  dirtyParts.clear();
  nextTick(() => {
    if (eventStreamContainer.value) {
      eventStreamContainer.value.scrollTop = eventStreamContainer.value.scrollHeight;
    }
  });
}

function processEvent(data: any) {
  const type: string = data.type;
  const props = data.properties || {};

  if (type === 'message.part.delta' && props.field === 'text') {
    const partId = props.partID;
    if (!partId) return;
    const existing = partsMap.get(partId);
    if (existing?.hidden) return;
    const part = getOrCreatePart(partId, props.sessionID, 'reasoning');
    part.text += props.delta || '';
    part.updatedAt = Date.now();
    dirtyParts.add(partId);
    return;
  }

  if (type === 'message.part.updated') {
    const partData = props.part || {};
    const partId = partData.id || props.partID;
    if (!partId) return;

    const partType: string = partData.type || '';
    const part = getOrCreatePart(partId, props.sessionID, partType as any);

    if (partType === 'reasoning') {
      part.text = partData.text || part.text;
    } else if (partType === 'tool') {
      part.type = 'tool';
      part.toolName = partData.toolName || partData.tool;
      part.toolCallId = partData.callID;
      part.toolStatus = partData.status || partData.state;
      part.toolInput = partData.input || partData.toolInput;
      part.toolOutput = partData.output || partData.toolOutput;
    }

    if (partData.status === 'completed' || partData.state === 'completed') {
      part.toolStatus = 'completed';
    }

    part.updatedAt = Date.now();
    dirtyParts.add(partId);
    return;
  }

  if (type === 'message.part.created') {
    const partData = props.part || {};
    const partId = partData.id || props.partID;
    if (!partId) return;
    const partType: string = partData.type || '';
    const part = getOrCreatePart(partId, props.sessionID, partType as any);

    if (partType === 'tool') {
      part.type = 'tool';
      part.toolName = partData.toolName || partData.tool;
      part.toolCallId = partData.callID;
      part.toolStatus = partData.status || partData.state;
    }
    part.updatedAt = Date.now();
    dirtyParts.add(partId);
    return;
  }

  if (type === 'step' && props.step) {
    const stepPartId = `step-${props.step.type}-${props.step.name || Date.now()}`;
    const part = getOrCreatePart(stepPartId, '', 'step');
    part.stepType = props.step.type;
    part.text = props.step.name || props.step.type;
    part.updatedAt = Date.now();
    dirtyParts.add(stepPartId);
  }
}

function connectEventStream() {
  const url = `/api/wape/event_stream/${taskId}`;
  eventSource = new EventSource(url);
  eventSource.onopen = () => {
    eventStreamConnected.value = true;
  };
  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      processEvent(data);
    } catch {
      // ignore parse errors
    }
  };
  eventSource.onerror = () => {
    eventStreamConnected.value = false;
    if (eventSource) {
      eventSource.close();
    }
  };
}

const toolStatusIcon: Record<string, string> = {
  running: '\u{1F504}',
  completed: '\u2705',
  pending: '\u23F3',
};

onMounted(() => {
  fetchDetail();
  connectEventStream();
  flushTimer = setInterval(flushDirtyParts, FLUSH_INTERVAL);
});

onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
  }
  if (flushTimer) {
    clearInterval(flushTimer);
  }
});
</script>

<template>
  <Page
    :description="`任务 ${taskId} 的判定详情与思考流程`"
    title="Cosmic 任务详情"
  >
    <div class="flex gap-0">
      <!-- Left panel: tree -->
      <div
        class="flex flex-col rounded border transition-all duration-300 overflow-hidden"
        :style="leftPanelStyle"
      >
        <div class="flex items-center gap-2 border-b bg-gray-50 px-4 py-3 text-sm font-medium">
          <span>📋 功能存在性判定</span>
          <Tag v-if="treeData" color="blue">{{ countLeafNodes(treeData) }} 项</Tag>
          <Tag v-if="treeData" color="green">{{ countExists(treeData) }} 已实现</Tag>
          <Tag v-if="treeData" color="red">{{ countNotExists(treeData) }} 未实现</Tag>
          <Tag v-if="treeData" color="orange">{{ countPending(treeData) }} 待判定</Tag>
        </div>
        <div class="flex-1 overflow-auto p-4" style="min-height: 500px">
          <div v-if="loading" class="flex items-center justify-center py-20 text-gray-400">
            加载中...
          </div>
          <div
            v-else-if="!treeData"
            class="flex items-center justify-center py-20 text-gray-400"
          >
            暂无判定数据
          </div>
          <div v-else class="space-y-1">
            <div
              v-for="node in flatNodes"
              :key="node.path"
            >
              <div
                class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all hover:bg-gray-100"
                :class="{
                  'bg-blue-50 ring-1 ring-blue-200': selectedEvidence === node.evidence && !node.hasChildren
                }"
                :style="{ marginLeft: `${node.depth * 20}px` }"
                @click="node.hasChildren ? toggleExpand(node.path) : selectEvidence(node.evidence)"
              >
                <span v-if="node.hasChildren" class="w-4 text-center text-xs text-gray-400 shrink-0">
                  {{ expandedPaths.has(node.path) ? '\u25BC' : '\u25B6' }}
                </span>
                <span v-else class="w-4 shrink-0"></span>

                <span
                  v-if="node.evidence"
                  class="inline-block h-2 w-2 shrink-0 rounded-full"
                  :class="node.evidence.exists ? 'bg-green-500' : 'bg-red-400'"
                />
                <span
                  v-else-if="node.hasChildren"
                  class="inline-block h-2 w-2 shrink-0 rounded-full bg-gray-300"
                />
                <span
                  v-else
                  class="inline-block h-2 w-2 shrink-0 rounded-full bg-yellow-300"
                />

                <span class="flex-1 truncate font-medium text-gray-700">{{ node.name }}</span>

                <Tag
                  v-if="!node.hasChildren && node.evidence"
                  :color="node.evidence.exists ? 'success' : 'error'"
                  class="shrink-0"
                >
                  {{ node.evidence.exists ? '\u5DF2\u5B9E\u73B0' : '\u672A\u5B9E\u73B0' }}
                </Tag>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Evidence detail panel -->
      <div
        v-if="selectedEvidence"
        class="flex flex-col rounded border transition-all duration-300 overflow-hidden"
        :style="{ width: '0', minWidth: '380px', marginLeft: '8px' }"
      >
        <div class="flex items-center justify-between border-b bg-gray-50 px-4 py-3 text-sm font-medium">
          <span>📎 判定详情</span>
          <span
            class="cursor-pointer text-xs text-gray-400 hover:text-gray-600"
            @click="selectedEvidence = null"
          >✕</span>
        </div>
        <div class="flex-1 overflow-auto p-4 text-sm">
          <Descriptions :column="1" border size="small">
            <Descriptions.Item label="功能路径">
              <code class="break-all text-xs">{{ selectedEvidence.input_path }}</code>
            </Descriptions.Item>
            <Descriptions.Item label="是否存在">
              <Tag :color="selectedEvidence.exists ? 'success' : 'error'">
                {{ selectedEvidence.exists ? '\u662F' : '\u5426' }}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="判定理由">
              <pre class="whitespace-pre-wrap break-all rounded bg-gray-100 p-2 text-xs">{{ selectedEvidence.reason }}</pre>
            </Descriptions.Item>
          </Descriptions>

          <div v-if="selectedEvidence.details?.frontend" class="mt-4">
            <div class="mb-2 text-xs font-medium text-gray-500">前端分析</div>
            <Descriptions :column="1" border size="small">
              <Descriptions.Item label="是否存在">
                <Tag :color="selectedEvidence.details.frontend.exists ? 'success' : 'error'">
                  {{ selectedEvidence.details.frontend.exists ? '\u662F' : '\u5426' }}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="分析理由">
                <pre class="whitespace-pre-wrap break-all rounded bg-gray-100 p-2 text-xs">{{ selectedEvidence.details.frontend.reason }}</pre>
              </Descriptions.Item>
              <Descriptions.Item v-if="selectedEvidence.details.frontend.searched_keywords" label="搜索关键词">
                <div class="flex flex-wrap gap-1">
                  <Tag v-for="kw in selectedEvidence.details.frontend.searched_keywords" :key="kw">
                    {{ kw }}
                  </Tag>
                </div>
              </Descriptions.Item>
              <Descriptions.Item v-if="selectedEvidence.details.frontend.searched_paths" label="搜索路径">
                <div class="space-y-1">
                  <div
                    v-for="p in selectedEvidence.details.frontend.searched_paths"
                    :key="p"
                    class="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600"
                  >
                    <code>{{ p }}</code>
                  </div>
                </div>
              </Descriptions.Item>
            </Descriptions>
          </div>

          <div v-if="selectedEvidence.details?.backend" class="mt-4">
            <div class="mb-2 text-xs font-medium text-gray-500">后端分析</div>
            <Descriptions :column="1" border size="small">
              <Descriptions.Item label="是否存在">
                <Tag :color="selectedEvidence.details.backend.exists ? 'success' : 'error'">
                  {{ selectedEvidence.details.backend.exists ? '\u662F' : '\u5426' }}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="分析理由">
                <pre class="whitespace-pre-wrap break-all rounded bg-gray-100 p-2 text-xs">{{ selectedEvidence.details.backend.reason }}</pre>
              </Descriptions.Item>
              <Descriptions.Item v-if="selectedEvidence.details.backend.searched_keywords" label="搜索关键词">
                <div class="flex flex-wrap gap-1">
                  <Tag v-for="kw in selectedEvidence.details.backend.searched_keywords" :key="kw">
                    {{ kw }}
                  </Tag>
                </div>
              </Descriptions.Item>
              <Descriptions.Item v-if="selectedEvidence.details.backend.searched_paths" label="搜索路径">
                <div class="space-y-1">
                  <div
                    v-for="p in selectedEvidence.details.backend.searched_paths"
                    :key="p"
                    class="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600"
                  >
                    <code>{{ p }}</code>
                  </div>
                </div>
              </Descriptions.Item>
            </Descriptions>
          </div>
        </div>
      </div>

      <!-- Resize handle -->
      <div class="relative flex flex-col" :style="{ width: '0' }">
        <div
          class="absolute -left-3 top-8 z-20 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-gray-200 bg-white text-xs text-gray-400 shadow-sm transition-all hover:border-blue-300 hover:text-blue-500 hover:shadow-md"
          :title="rightCollapsed ? '\u5C55\u5F00\u601D\u8003\u6D41\u7A0B' : '\u6536\u8D77\u601D\u8003\u6D41\u7A0B'"
          @click="toggleRight"
        >
          <span class="select-none leading-none text-[10px]">
            {{ rightCollapsed ? '\u25C0' : '\u25B6' }}
          </span>
        </div>
      </div>

      <!-- Right panel: thinking flow -->
      <div
        class="flex flex-col rounded border transition-all duration-300 overflow-hidden"
        :style="rightPanelStyle"
      >
        <div
          class="flex items-center gap-2 border-b bg-gray-50 px-4 py-3 text-sm font-medium"
        >
          <span>🤖 思考流程</span>
          <span
            class="inline-block h-2 w-2 rounded-full"
            :style="{
              backgroundColor: eventStreamConnected ? '#52c41a' : '#d9d9d9',
            }"
          ></span>
          <span class="text-xs text-gray-400">
            {{ eventStreamConnected ? '\u5DF2\u8FDE\u63A5' : '\u672A\u8FDE\u63A5' }}
          </span>
        </div>
        <div
          ref="eventStreamContainer"
          class="flex-1 overflow-y-auto p-4"
          style="min-height: 400px; max-height: 540px"
        >
          <template v-if="mergedDisplayItems.length === 0">
            <div class="pt-16 text-center text-gray-400">
              <div class="mb-2 text-3xl">⚡</div>
              <div>
                {{ eventStreamConnected ? '\u7B49\u5F85 AI \u601D\u8003...' : '\u6682\u65E0\u8FDE\u63A5' }}
              </div>
            </div>
          </template>

          <div class="space-y-3">
            <div
              v-for="item in mergedDisplayItems"
              :key="item.type === 'merged-reasoning' ? item.ids[0] : item.id"
              class="animate-fade-in"
            >
              <div
                v-if="item.type === 'merged-reasoning'"
                class="rounded-lg border border-blue-100 bg-blue-50/60 p-3"
              >
                <div class="mb-1.5 flex items-center gap-1.5 text-xs text-blue-400">
                  <span>💭</span>
                  <span>推理中</span>
                  <span
                    class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400"
                  ></span>
                </div>
                <div
                  class="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 space-y-2"
                >
                  <template v-for="(text, tIdx) in item.texts" :key="tIdx">
                    <div v-if="text.trim()" class="text-gray-700">{{ text }}</div>
                  </template>
                  <span
                    class="inline-block h-3.5 w-0.5 animate-pulse bg-blue-300 align-text-bottom"
                  ></span>
                </div>
              </div>

              <div
                v-if="item.type === 'tool'"
                class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
              >
                <div class="mb-1.5 flex items-center gap-2">
                  <span class="text-base">
                    {{ toolStatusIcon[item.toolStatus || ''] || '🔧' }}
                  </span>
                  <span class="text-xs font-medium text-gray-500">
                    {{ item.toolName || '\u5DE5\u5177\u8C03\u7528' }}
                  </span>
                  <Tag
                    v-if="item.toolStatus"
                    :color="item.toolStatus === 'completed' ? 'success' : item.toolStatus === 'running' ? 'processing' : 'default'"
                  >
                    {{ item.toolStatus }}
                  </Tag>
                </div>
                <div
                  v-if="item.toolInput"
                  class="mb-1 rounded bg-gray-100 p-2 text-xs text-gray-500"
                >
                  <div class="mb-0.5 font-medium">输入:</div>
                  <pre class="whitespace-pre-wrap break-all">{{ item.toolInput }}</pre>
                </div>
                <div
                  v-if="item.toolOutput && !item.hideContent"
                  class="rounded bg-gray-50 p-2 text-xs text-gray-500"
                >
                  <div class="mb-0.5 font-medium">输出:</div>
                  <pre class="whitespace-pre-wrap break-all">{{ item.toolOutput }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Page>
</template>
