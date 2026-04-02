<script setup lang="ts">
/** @fileoverview Detailed task view with file list, peers, and BT info. */
import { ref, computed, watch, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { TASK_STATUS } from '@shared/constants'
import {
  checkTaskIsBT,
  checkTaskIsSeeder,
  getTaskDisplayName,
  bytesToSize,
  calcProgress,
  calcRatio,
  getFileName,
  getFileExtension,
  localeDateTimeFormat,
  bitfieldToPercent,
  peerIdParser,
  timeRemaining,
  timeFormat,
} from '@shared/utils'
import { decodePathSegment } from '@shared/utils/batchHelpers'
import {
  NDrawer,
  NDrawerContent,
  NDescriptions,
  NDescriptionsItem,
  NDataTable,
  NIcon,
  NProgress,
  NTag,
  NButton,
  NRadioGroup,
  NRadio,
  NInput,
  NFormItem,
  NCollapseTransition,
} from 'naive-ui'
import {
  InformationCircleOutline,
  PulseOutline,
  DocumentOutline,
  PeopleOutline,
  ServerOutline,
  SettingsOutline,
} from '@vicons/ionicons5'
import TaskGraphic from './TaskGraphic.vue'
import { useTrackerProbe, buildTrackerRows, type TrackerRow } from '@/composables/useTrackerProbe'
import { useTaskDetailOptions } from '@/composables/useTaskDetailOptions'
import { usePreferenceStore } from '@/stores/preference'
import { useTaskStore } from '@/stores/task'
import { useAppMessage } from '@/composables/useAppMessage'
import type { Aria2Task, Aria2File, Aria2Peer } from '@shared/types'

const props = defineProps<{
  show: boolean
  task: Aria2Task | null
  files: Aria2File[]
}>()
const emit = defineEmits<{ close: [] }>()

const { t, locale } = useI18n()
const preferenceStore = usePreferenceStore()
const taskStore = useTaskStore()
const message = useAppMessage()
const taskRef = computed(() => props.task)

const {
  form: optForm,
  canModify: optCanModify,
  globalProxyAvailable: optGlobalProxyAvailable,
  proxyAddress: optProxyAddress,
  dirty: optDirty,
  applying: optApplying,
  applyOptions: optApplyFn,
} = useTaskDetailOptions({
  task: taskRef,
  getTaskOption: (gid) => taskStore.getTaskOption(gid),
  changeTaskOption: (payload) => taskStore.changeTaskOption(payload),
  proxyConfig: () => preferenceStore.config.proxy,
  message,
  t,
})

const activeTab = ref('general')
const slideDirection = ref<'left' | 'right'>('left')
const prevTabIndex = ref(0)

interface TabDef {
  key: string
  labelKey: string
  icon: typeof InformationCircleOutline
  btOnly?: boolean
}
const allTabs: TabDef[] = [
  { key: 'general', labelKey: 'task.task-tab-general', icon: InformationCircleOutline },
  { key: 'activity', labelKey: 'task.task-tab-activity', icon: PulseOutline },
  { key: 'files', labelKey: 'task.task-tab-files', icon: DocumentOutline },
  { key: 'options', labelKey: 'task.task-tab-options', icon: SettingsOutline },
  { key: 'peers', labelKey: 'task.task-tab-peers', icon: PeopleOutline, btOnly: true },
  { key: 'trackers', labelKey: 'task.task-tab-trackers', icon: ServerOutline, btOnly: true },
]

const visibleTabs = computed(() => allTabs.filter((tab) => !tab.btOnly || isBT.value))

function switchTab(key: string) {
  const oldIdx = visibleTabs.value.findIndex((t) => t.key === activeTab.value)
  const newIdx = visibleTabs.value.findIndex((t) => t.key === key)
  slideDirection.value = newIdx > oldIdx ? 'left' : 'right'
  prevTabIndex.value = newIdx
  activeTab.value = key
}

const isBT = computed(() => (props.task ? checkTaskIsBT(props.task) : false))

const prevTaskGid = ref('')
watch(
  () => props.task?.gid,
  (gid) => {
    if (gid && gid !== prevTaskGid.value) {
      activeTab.value = 'general'
      prevTaskGid.value = gid
    }
  },
)
const isSeeder = computed(() => (props.task ? checkTaskIsSeeder(props.task) : false))
const taskStatusKey = computed(() => (isSeeder.value ? TASK_STATUS.SEEDING : props.task?.status))
const taskStatus = computed(() => {
  const key = taskStatusKey.value
  const translated = t(`task.status-${key}`)
  return translated !== `task.status-${key}` ? translated : key
})
const isActive = computed(() => props.task?.status === TASK_STATUS.ACTIVE)
const taskFullName = computed(() => (props.task ? getTaskDisplayName(props.task, { defaultName: 'Unknown' }) : ''))
const percent = computed(() => (props.task ? calcProgress(props.task.totalLength, props.task.completedLength) : 0))

const remaining = computed(() => {
  if (!isActive.value || !props.task) return 0
  return timeRemaining(
    Number(props.task.totalLength),
    Number(props.task.completedLength),
    Number(props.task.downloadSpeed),
  )
})

const remainingText = computed(() => {
  if (remaining.value <= 0) return ''
  return timeFormat(remaining.value, {
    prefix: t('task.remaining-prefix') || '',
    i18n: {
      gt1d: t('app.gt1d') || '>1d',
      hour: t('app.hour') || 'h',
      minute: t('app.minute') || 'm',
      second: t('app.second') || 's',
    },
  })
})

const ratio = computed(() => {
  if (!isBT.value || !props.task) return 0
  return calcRatio(Number(props.task.totalLength), Number(props.task.uploadLength))
})

const btInfo = computed(() => {
  if (!isBT.value || !props.task) return null
  return props.task.bittorrent
})

const statusTagType = computed(() => {
  switch (taskStatusKey.value) {
    case 'active':
      return 'warning'
    case 'complete':
      return 'success'
    case 'error':
      return 'error'
    default:
      return 'default'
  }
})

const fileList = computed(() =>
  (props.files || []).map((item: Aria2File) => {
    const name = decodePathSegment(getFileName(item.path))
    return {
      idx: Number(item.index),
      name,
      extension: '.' + getFileExtension(name),
      length: Number(item.length),
      completedLength: Number(item.completedLength),
      percent: calcProgress(item.length, item.completedLength, 1),
      selected: item.selected === 'true',
    }
  }),
)

const fileColumns = computed(() => [
  { title: '#', key: 'idx', width: 50 },
  { title: t('task.file-name') || 'Name', key: 'name', ellipsis: { tooltip: true } },
  { title: t('task.file-extension') || 'Ext', key: 'extension', width: 70 },
  { title: '%', key: 'percent', width: 60, align: 'right' as const },
  {
    title: '✓',
    key: 'completedLength',
    width: 90,
    align: 'right' as const,
    render: (row: { completedLength: number }) => bytesToSize(String(row.completedLength)),
  },
  {
    title: t('task.file-size') || 'Size',
    key: 'length',
    width: 90,
    align: 'right' as const,
    render: (row: { length: number }) => bytesToSize(String(row.length)),
  },
])

const peers = computed(() => {
  if (!props.task || !isBT.value) return []
  const p = props.task.peers
  return (p || []).map((peer: Aria2Peer) => ({
    host: `${peer.ip}:${peer.port}`,
    client: peerIdParser(peer.peerId),
    percent: peer.bitfield ? bitfieldToPercent(peer.bitfield) + '%' : '-',
    uploadSpeed: bytesToSize(peer.uploadSpeed) + '/s',
    downloadSpeed: bytesToSize(peer.downloadSpeed) + '/s',
    amChoking: peer.amChoking === 'true',
    peerChoking: peer.peerChoking === 'true',
    seeder: peer.seeder === 'true',
  }))
})

interface PeerRow {
  host: string
  client: string
  percent: string
  uploadSpeed: string
  downloadSpeed: string
  amChoking: boolean
  peerChoking: boolean
  seeder: boolean
}

const peerColumns = computed(() => [
  { title: t('task.task-peer-host'), key: 'host', minWidth: 140 },
  { title: t('task.task-peer-client'), key: 'client', minWidth: 100, ellipsis: { tooltip: true } },
  { title: '%', key: 'percent', width: 55, align: 'right' as const },
  { title: '↓', key: 'downloadSpeed', width: 90, align: 'right' as const },
  { title: '↑', key: 'uploadSpeed', width: 90, align: 'right' as const },
  {
    title: t('task.task-peer-flags'),
    key: 'flags',
    width: 60,
    align: 'center' as const,
    render: (row: PeerRow) => {
      const flags: string[] = []
      if (!row.amChoking) flags.push('D')
      if (!row.peerChoking) flags.push('U')
      return flags.join('') || '—'
    },
  },
  {
    title: 'S',
    key: 'seeder',
    width: 45,
    align: 'center' as const,
    render: (row: PeerRow) => (row.seeder ? '✓' : ''),
  },
])

const {
  statuses: trackerStatuses,
  probing: trackerProbing,
  probeAll: probeTrackers,
  cancelProbe: cancelTrackerProbe,
} = useTrackerProbe()

const trackerRows = computed((): TrackerRow[] => {
  if (!isBT.value || !btInfo.value) return []
  const rows = buildTrackerRows(btInfo.value.announceList)
  return rows.map((row) => ({
    ...row,
    status: trackerStatuses.value[row.url] ?? row.status,
  }))
})

const trackerColumns = computed(() => [
  { title: t('task.task-tracker-tier'), key: 'tier', width: 55, align: 'center' as const },
  { title: 'URL', key: 'url', ellipsis: { tooltip: true } },
  { title: t('task.task-tracker-protocol'), key: 'protocol', width: 75, align: 'center' as const },
  {
    title: t('task.task-tracker-status'),
    key: 'status',
    width: 100,
    align: 'center' as const,
    render: (row: TrackerRow) =>
      h(
        NTag,
        {
          type: row.status === 'online' ? 'success' : row.status === 'offline' ? 'error' : 'default',
          size: 'small',
          round: true,
          style: 'transition: all 0.3s cubic-bezier(0.05, 0.7, 0.1, 1)',
        },
        () => t(`task.task-tracker-${row.status}`),
      ),
  },
])

function handleProbeTrackers() {
  if (trackerProbing.value) {
    cancelTrackerProbe()
    return
  }
  const urls = trackerRows.value.map((r) => r.url)
  probeTrackers(urls)
}

function handleClose() {
  emit('close')
}
</script>

<template>
  <NDrawer
    :show="show"
    :width="'61.8%'"
    placement="right"
    :trap-focus="false"
    :block-scroll="false"
    @update:show="
      (v: boolean) => {
        if (!v) handleClose()
      }
    "
  >
    <NDrawerContent :title="t('task.task-detail-title') || 'Task Details'" closable @close="handleClose">
      <div class="detail-tabs">
        <button
          v-for="tab in visibleTabs"
          :key="tab.key"
          :class="['detail-tab', { active: activeTab === tab.key }]"
          @click="switchTab(tab.key)"
        >
          <NIcon :size="16"><component :is="tab.icon" /></NIcon>
          <span class="detail-tab-label">{{ t(tab.labelKey) }}</span>
        </button>
      </div>

      <div class="tab-content-wrapper">
        <Transition :name="`tab-slide-${slideDirection}`" mode="out-in">
          <div v-if="activeTab === 'general'" key="general" class="tab-content">
            <template v-if="task">
              <NDescriptions
                :column="1"
                label-placement="left"
                bordered
                size="small"
                :label-style="{ width: '1px', whiteSpace: 'nowrap' }"
              >
                <NDescriptionsItem :label="t('task.task-gid') || 'GID'">{{ task.gid }}</NDescriptionsItem>
                <NDescriptionsItem :label="t('task.task-name') || 'Name'">{{ taskFullName }}</NDescriptionsItem>
                <NDescriptionsItem :label="t('task.task-dir') || 'Directory'">{{ task.dir }}</NDescriptionsItem>
                <NDescriptionsItem :label="t('task.task-status') || 'Status'">
                  <NTag :type="statusTagType" size="small">{{ taskStatus }}</NTag>
                </NDescriptionsItem>
                <NDescriptionsItem
                  v-if="task.errorCode && task.errorCode !== '0'"
                  :label="t('task.task-error-info') || 'Error'"
                >
                  {{ task.errorCode }} {{ task.errorMessage }}
                </NDescriptionsItem>
              </NDescriptions>
              <template v-if="isBT && btInfo">
                <div class="section-divider">BitTorrent</div>
                <NDescriptions
                  :column="1"
                  label-placement="left"
                  bordered
                  size="small"
                  :label-style="{ width: '1px', whiteSpace: 'nowrap' }"
                >
                  <NDescriptionsItem :label="t('task.task-info-hash') || 'Hash'">{{ task.infoHash }}</NDescriptionsItem>
                  <NDescriptionsItem :label="t('task.task-piece-length') || 'Piece Size'">
                    {{ bytesToSize(String(task.pieceLength)) }}
                  </NDescriptionsItem>
                  <NDescriptionsItem :label="t('task.task-num-pieces') || 'Pieces'">
                    {{ task.numPieces }}
                  </NDescriptionsItem>
                  <NDescriptionsItem
                    v-if="btInfo?.creationDate"
                    :label="t('task.task-bittorrent-creation-date') || 'Created'"
                  >
                    {{ localeDateTimeFormat(Number(btInfo.creationDate), locale) }}
                  </NDescriptionsItem>
                  <NDescriptionsItem v-if="btInfo?.comment" :label="t('task.task-bittorrent-comment') || 'Comment'">
                    {{ btInfo.comment }}
                  </NDescriptionsItem>
                </NDescriptions>
              </template>
            </template>
          </div>

          <div v-else-if="activeTab === 'activity'" key="activity" class="tab-content">
            <template v-if="task">
              <TaskGraphic v-if="task.bitfield" :bitfield="task.bitfield" />
              <NDescriptions :column="1" label-placement="left" bordered size="small">
                <NDescriptionsItem :label="t('task.task-progress-info') || 'Progress'">
                  <div class="progress-row">
                    <NProgress type="line" :percentage="percent" :height="10" :show-indicator="false" processing />
                    <span class="progress-pct">{{ percent }}%</span>
                  </div>
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('task.task-file-size') || 'Size'">
                  {{ bytesToSize(task.completedLength, 2) }}
                  <span v-if="Number(task.totalLength) > 0"> / {{ bytesToSize(task.totalLength, 2) }}</span>
                  <span v-if="remainingText" class="remaining-text">{{ remainingText }}</span>
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('task.task-download-speed') || 'DL Speed'">
                  {{ bytesToSize(task.downloadSpeed) }}/s
                </NDescriptionsItem>
                <NDescriptionsItem v-if="isBT" :label="t('task.task-upload-speed') || 'UL Speed'">
                  {{ bytesToSize(task.uploadSpeed) }}/s
                </NDescriptionsItem>
                <NDescriptionsItem v-if="isBT" :label="t('task.task-upload-length') || 'Uploaded'">
                  {{ bytesToSize(task.uploadLength) }}
                </NDescriptionsItem>
                <NDescriptionsItem v-if="isBT" :label="t('task.task-ratio') || 'Ratio'">{{ ratio }}</NDescriptionsItem>
                <NDescriptionsItem v-if="isBT" :label="t('task.task-num-seeders') || 'Seeders'">
                  {{ task.numSeeders }}
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('task.task-connections') || 'Connections'">
                  {{ task.connections }}
                </NDescriptionsItem>
              </NDescriptions>
            </template>
          </div>

          <div v-else-if="activeTab === 'files'" key="files" class="tab-content">
            <NDataTable
              :columns="fileColumns"
              :data="fileList"
              :row-key="(row) => row.idx"
              size="small"
              :bordered="true"
              :max-height="400"
              virtual-scroll
              striped
            />
          </div>

          <div v-else-if="activeTab === 'options'" key="options" class="tab-content">
            <div class="options-form">
              <NFormItem :label="t('task.task-user-agent') + ':'">
                <NInput
                  v-model:value="optForm.userAgent"
                  type="textarea"
                  :autosize="{ minRows: 1, maxRows: 3 }"
                  :readonly="!optCanModify"
                  :placeholder="t('task.task-user-agent-placeholder') || ''"
                />
              </NFormItem>
              <NFormItem :label="t('task.task-authorization') + ':'">
                <NInput
                  v-model:value="optForm.authorization"
                  type="textarea"
                  :autosize="{ minRows: 1, maxRows: 3 }"
                  :readonly="!optCanModify"
                  :placeholder="t('task.task-authorization-placeholder') || ''"
                />
              </NFormItem>
              <NFormItem :label="t('task.task-referer') + ':'">
                <NInput
                  v-model:value="optForm.referer"
                  type="textarea"
                  :autosize="{ minRows: 1, maxRows: 3 }"
                  :readonly="!optCanModify"
                  :placeholder="t('task.task-referer-placeholder') || ''"
                />
              </NFormItem>
              <NFormItem :label="t('task.task-cookie') + ':'">
                <NInput
                  v-model:value="optForm.cookie"
                  type="textarea"
                  :autosize="{ minRows: 1, maxRows: 3 }"
                  :readonly="!optCanModify"
                  :placeholder="t('task.task-cookie-placeholder') || ''"
                />
              </NFormItem>
              <NFormItem :label="t('task.task-proxy-label') + ':'">
                <div class="proxy-radio-group">
                  <NRadioGroup v-model:value="optForm.proxyMode" :disabled="!optCanModify" name="task-proxy-mode">
                    <NRadio value="none">{{ t('task.proxy-mode-none') }}</NRadio>
                    <NRadio v-if="optGlobalProxyAvailable" value="global">
                      {{ t('task.proxy-mode-global') }}
                    </NRadio>
                    <NRadio value="custom">{{ t('task.proxy-mode-custom') }}</NRadio>
                  </NRadioGroup>
                  <div
                    class="proxy-hint-collapse"
                    :class="{ 'proxy-hint-collapse--open': optForm.proxyMode === 'global' }"
                  >
                    <div class="proxy-hint-collapse__inner">
                      <div class="proxy-server-hint">{{ t('task.proxy-global-server') }} {{ optProxyAddress }}</div>
                    </div>
                  </div>
                  <NCollapseTransition :show="optForm.proxyMode === 'custom'">
                    <NInput
                      v-model:value="optForm.customProxy"
                      :readonly="!optCanModify"
                      :placeholder="'http://host:port'"
                      class="custom-proxy-input"
                    />
                  </NCollapseTransition>
                </div>
              </NFormItem>
              <div v-if="optCanModify" class="options-apply-bar">
                <NButton
                  :type="optDirty ? 'primary' : 'default'"
                  :disabled="!optDirty"
                  :loading="optApplying"
                  class="apply-btn"
                  @click="optApplyFn"
                >
                  {{ optDirty ? t('task.apply-changes') : t('task.no-changes') }}
                </NButton>
              </div>
            </div>
          </div>

          <div v-else-if="activeTab === 'peers'" key="peers" class="tab-content">
            <NDataTable
              :columns="peerColumns"
              :data="peers"
              :row-key="(row) => row.host"
              size="small"
              :bordered="true"
              :max-height="400"
              striped
            />
          </div>

          <div v-else-if="activeTab === 'trackers'" key="trackers" class="tab-content">
            <div style="margin-bottom: 12px; height: 34px">
              <NButton
                size="medium"
                :type="trackerProbing ? 'default' : 'primary'"
                class="probe-btn"
                @click="handleProbeTrackers"
              >
                <template v-if="trackerProbing" #icon>
                  <div class="probe-spinner" />
                </template>
                {{ trackerProbing ? t('task.task-tracker-cancel-probe') : t('task.task-tracker-probe') }}
              </NButton>
            </div>
            <NDataTable
              :columns="trackerColumns"
              :data="trackerRows"
              :row-key="(row: TrackerRow) => row.url"
              size="small"
              :bordered="true"
              :max-height="400"
              striped
            />
          </div>
        </Transition>
      </div>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.detail-tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--panel-border, #3a3a3a);
  padding-bottom: 0;
  margin-bottom: 0;
}

.detail-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 12px;
  height: 36px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--task-action-color, #999);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.detail-tab:hover {
  color: var(--color-primary);
}

.detail-tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.tab-content-wrapper {
  overflow: hidden;
  position: relative;
}

.tab-content {
  padding: 16px 0;
}

.section-divider {
  margin: 20px 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-primary);
  letter-spacing: 0.5px;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-pct {
  white-space: nowrap;
  font-size: 12px;
  color: var(--m3-on-surface-variant);
  min-width: 45px;
  text-align: right;
}

.remaining-text {
  margin-left: 12px;
  color: var(--m3-on-surface-variant);
  font-size: 12px;
}

.detail-footer {
  display: flex;
  justify-content: center;
}

.detail-footer :deep(.task-item-actions) {
  position: static;
  width: auto;
  height: auto;
  overflow: visible;
  direction: ltr;
  text-align: center;
}

.tab-slide-left-enter-active,
.tab-slide-left-leave-active,
.tab-slide-right-enter-active,
.tab-slide-right-leave-active {
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.tab-slide-left-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.tab-slide-left-leave-to {
  opacity: 0;
  transform: translateX(-40px);
}

.tab-slide-right-enter-from {
  opacity: 0;
  transform: translateX(-40px);
}
.tab-slide-right-leave-to {
  opacity: 0;
  transform: translateX(40px);
}

/* Probe button M3 transition */
.probe-btn {
  transition:
    background-color 0.3s cubic-bezier(0.2, 0, 0, 1),
    border-color 0.3s cubic-bezier(0.2, 0, 0, 1),
    color 0.3s cubic-bezier(0.2, 0, 0, 1);
}

/* Spinning indicator matching Naive UI's loading style */
.probe-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: m3-spin 0.8s linear infinite;
  will-change: transform;
  contain: layout style paint;
}

@keyframes m3-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Options tab ─────────────────────────────────────────────────── */
.options-form {
  padding: 4px 0;
}
.options-apply-bar {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
.apply-btn {
  transition:
    background-color 0.25s cubic-bezier(0.2, 0, 0, 1),
    border-color 0.25s cubic-bezier(0.2, 0, 0, 1),
    color 0.25s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.25s cubic-bezier(0.2, 0, 0, 1);
}
.proxy-radio-group {
  display: flex;
  flex-direction: column;
  width: 100%;
}
.custom-proxy-input {
  margin-top: 4px;
  margin-left: 24px;
}
.proxy-hint-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s ease;
}
.proxy-hint-collapse--open {
  grid-template-rows: 1fr;
}
.proxy-hint-collapse__inner {
  overflow: hidden;
}
.proxy-server-hint {
  font-size: var(--font-size-sm);
  color: var(--n-text-color-3, #999);
  opacity: 0.8;
  user-select: all;
  padding: 4px 0 2px;
}
</style>
