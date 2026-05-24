<script lang="ts" setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { Button, message, Tag } from 'ant-design-vue';
import * as XLSX from 'xlsx';

import { exportCosmicReportApi } from '#/api/core/cosmic';

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
const router = useRouter();
const taskId = route.params.taskId as string;

const excelLoading = ref(false);
const excelData = ref<{ headers: string[]; rows: string[][] } | null>(null);

const leftWidth = ref(70);
const rightCollapsed = ref(false);

function toggleRight() {
  rightCollapsed.value = !rightCollapsed.value;
}

const leftPanelStyle = computed(() => {
  if (rightCollapsed.value) {
    return { width: '100%' };
  }
  return { width: `${leftWidth.value}%` };
});

const rightPanelStyle = computed(() => {
  if (rightCollapsed.value) {
    return { width: '0', minWidth: '0', overflow: 'hidden', border: 'none' };
  }
  return { width: `calc(${100 - leftWidth.value}%)` };
});

async function loadExcel() {
  excelLoading.value = true;
  try {
    const res = await exportCosmicReportApi(taskId);
    const blob = res.data as Blob;
    const buffer = await blob.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      excelData.value = null;
      return;
    }
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    if (json.length === 0) {
      excelData.value = { headers: [], rows: [] };
      return;
    }
    excelData.value = {
      headers: json[0] as string[],
      rows: json.slice(1) as string[][],
    };
  } catch {
    excelData.value = null;
  } finally {
    excelLoading.value = false;
  }
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
  running: '🔄',
  completed: '✅',
  pending: '⏳',
};

onMounted(() => {
  loadExcel();
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
    :description="`任务 ${taskId} 的评估详情与思考流程`"
    title="Cosmic 任务详情"
  >
    <div class="flex gap-0">
      <!-- Left panel: Excel content -->
      <div
        class="flex flex-col rounded border transition-all duration-300 overflow-hidden"
        :style="leftPanelStyle"
      >
        <div class="flex items-center gap-2 border-b bg-gray-50 px-4 py-3 text-sm font-medium">
          <span>📊 评估结果</span>
          <Tag v-if="excelData" color="blue">
            {{ excelData.rows.length }} 行
          </Tag>
        </div>
        <div class="flex-1 overflow-auto p-4" style="min-height: 500px">
          <div v-if="excelLoading" class="flex items-center justify-center py-20 text-gray-400">
            加载报告中...
          </div>
          <div
            v-else-if="!excelData"
            class="flex items-center justify-center py-20 text-gray-400"
          >
            暂无报告数据
          </div>
          <table v-else class="min-w-full border-collapse text-sm">
            <thead>
              <tr class="bg-gray-50">
                <th
                  v-for="(h, idx) in excelData.headers"
                  :key="idx"
                  class="border border-gray-200 px-3 py-2 text-left font-medium text-gray-600"
                >
                  {{ h }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rIdx) in excelData.rows" :key="rIdx" class="hover:bg-gray-50">
                <td
                  v-for="(cell, cIdx) in row"
                  :key="cIdx"
                  class="border border-gray-200 px-3 py-1.5 text-gray-700"
                >
                  <div
                    :style="
                      typeof cell === 'string' && cell.startsWith('#')
                        ? { backgroundColor: cell, width: '20px', height: '20px', borderRadius: '4px' }
                        : {}
                    "
                  >
                    {{ typeof cell === 'string' && cell.startsWith('#') ? '' : cell }}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Resize handle -->
      <div class="relative flex flex-col" :style="{ width: '0' }">
        <div
          class="absolute -left-3 top-8 z-20 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-gray-200 bg-white text-xs text-gray-400 shadow-sm transition-all hover:border-blue-300 hover:text-blue-500 hover:shadow-md"
          :title="rightCollapsed ? '展开思考流程' : '收起思考流程'"
          @click="toggleRight"
        >
          <span class="select-none leading-none text-[10px]">
            {{ rightCollapsed ? '◀' : '▶' }}
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
            {{ eventStreamConnected ? '已连接' : '未连接' }}
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
                {{ eventStreamConnected ? '等待 AI 思考...' : '暂无连接' }}
              </div>
            </div>
          </template>

          <div class="space-y-3">
            <div
              v-for="item in mergedDisplayItems"
              :key="item.type === 'merged-reasoning' ? item.ids[0] : item.id"
              class="animate-fade-in"
            >
              <!-- merged reasoning block -->
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

              <!-- tool call block -->
              <div
                v-if="item.type === 'tool'"
                class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
              >
                <div class="mb-1.5 flex items-center gap-2">
                  <span class="text-base">
                    {{ toolStatusIcon[item.toolStatus || ''] || '🔧' }}
                  </span>
                  <span class="text-xs font-medium text-gray-500">
                    {{ item.toolName || '工具调用' }}
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