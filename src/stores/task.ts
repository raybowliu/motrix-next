/** @fileoverview Pinia store for download task management: list, add, pause, resume, remove. */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { EMPTY_STRING, TASK_STATUS } from '@shared/constants'
import { checkTaskIsBT, checkTaskIsSeeder, getTaskUris, intersection } from '@shared/utils'
import { logger } from '@shared/logger'
import type {
  Aria2Task,
  Aria2File,
  Aria2Peer,
  Aria2EngineOptions,
  AddUriParams,
  AddTorrentParams,
  AddMetalinkParams,
  TaskOptionParams,
} from '@shared/types'

export type { Aria2Task, Aria2File, Aria2Peer }

interface TaskApi {
  fetchTaskList: (params: { type: string }) => Promise<Aria2Task[]>
  fetchTaskItem: (params: { gid: string }) => Promise<Aria2Task>
  fetchTaskItemWithPeers: (params: { gid: string }) => Promise<Aria2Task & { peers: Aria2Peer[] }>
  fetchActiveTaskList: () => Promise<Aria2Task[]>
  addUri: (params: AddUriParams) => Promise<string[]>
  addUriAtomic: (params: { uris: string[]; options: Record<string, string> }) => Promise<string>
  addTorrent: (params: AddTorrentParams) => Promise<string>
  addMetalink: (params: AddMetalinkParams) => Promise<string[]>
  getOption: (params: { gid: string }) => Promise<Record<string, string>>
  changeOption: (params: TaskOptionParams) => Promise<void>
  removeTask: (params: { gid: string }) => Promise<string>
  forcePauseTask: (params: { gid: string }) => Promise<string>
  pauseTask: (params: { gid: string }) => Promise<string>
  resumeTask: (params: { gid: string }) => Promise<string>
  pauseAllTask: () => Promise<string>
  forcePauseAllTask: () => Promise<string>
  resumeAllTask: () => Promise<string>
  batchResumeTask: (params: { gids: string[] }) => Promise<unknown[][]>
  batchPauseTask: (params: { gids: string[] }) => Promise<unknown[][]>
  batchForcePauseTask: (params: { gids: string[] }) => Promise<unknown[][]>
  batchRemoveTask: (params: { gids: string[] }) => Promise<unknown[][]>
  removeTaskRecord: (params: { gid: string }) => Promise<string>
  purgeTaskRecord: () => Promise<string>
  saveSession: () => Promise<string>
}

export const useTaskStore = defineStore('task', () => {
  const currentList = ref('active')
  const taskDetailVisible = ref(false)
  const currentTaskGid = ref(EMPTY_STRING)
  const enabledFetchPeers = ref(false)
  const currentTaskItem = ref<Aria2Task | null>(null)
  const currentTaskFiles = ref<Aria2File[]>([])
  const currentTaskPeers = ref<Aria2Peer[]>([])
  const seedingList = ref<string[]>([])
  const taskList = ref<Aria2Task[]>([])
  const selectedGidList = ref<string[]>([])

  let api: TaskApi

  const notifiedErrorGids = new Set<string>()
  let initialScanDone = false
  let onTaskError: ((task: Aria2Task) => void) | null = null

  function setOnTaskError(fn: (task: Aria2Task) => void) {
    onTaskError = fn
  }

  function setApi(a: TaskApi) {
    api = a
  }

  async function changeCurrentList(list: string) {
    currentList.value = list
    taskList.value = []
    selectedGidList.value = []
    await fetchList()
  }

  async function fetchList() {
    try {
      const data = await api.fetchTaskList({ type: currentList.value })
      taskList.value = data
      const gids = data.map((task: Aria2Task) => task.gid)
      selectedGidList.value = intersection(selectedGidList.value, gids)
      if (taskDetailVisible.value && currentTaskGid.value) {
        try {
          const fresh = await api.fetchTaskItemWithPeers({ gid: currentTaskGid.value })
          if (fresh) updateCurrentTaskItem(fresh)
        } catch (e) {
          logger.debug('TaskStore.fetchPeers', e)
          const fresh = data.find((t: Aria2Task) => t.gid === currentTaskGid.value)
          if (fresh) updateCurrentTaskItem(fresh)
        }
      }
      // Detect newly errored tasks and notify
      if (onTaskError) {
        // When viewing the active tab, error tasks land in the stopped pool
        // so also fetch recent stopped tasks for error scanning
        const tasksToScan =
          currentList.value === TASK_STATUS.ACTIVE
            ? [...data, ...(await api.fetchTaskList({ type: 'stopped' })).slice(0, 20)]
            : data
        for (const task of tasksToScan) {
          if (
            task.status === TASK_STATUS.ERROR &&
            task.errorCode &&
            task.errorCode !== '0' &&
            !notifiedErrorGids.has(task.gid)
          ) {
            notifiedErrorGids.add(task.gid)
            // Skip notifications on first scan to avoid re-alerting stale errors
            if (initialScanDone) {
              onTaskError(task)
            }
          }
        }
        initialScanDone = true
      }
    } catch (e) {
      logger.warn('TaskStore.fetchList', (e as Error).message)
    }
  }

  function selectTasks(list: string[]) {
    selectedGidList.value = list
  }

  function selectAllTask() {
    selectedGidList.value = taskList.value.map((task) => task.gid)
  }

  async function fetchItem(gid: string) {
    const data = await api.fetchTaskItem({ gid })
    updateCurrentTaskItem(data)
  }

  function showTaskDetail(task: Aria2Task) {
    updateCurrentTaskItem(task)
    currentTaskGid.value = task.gid
    taskDetailVisible.value = true
  }

  async function showTaskDetailByGid(gid: string) {
    const task = await api.fetchTaskItem({ gid })
    showTaskDetail(task)
  }

  function hideTaskDetail() {
    taskDetailVisible.value = false
  }

  function updateCurrentTaskItem(task: Aria2Task | null) {
    currentTaskItem.value = task
    if (task) {
      currentTaskFiles.value = task.files
      currentTaskPeers.value = task.peers || []
    } else {
      currentTaskFiles.value = []
      currentTaskPeers.value = []
    }
  }

  async function addUri(data: { uris: string[]; outs: string[]; options: Aria2EngineOptions }) {
    await api.addUri(data)
    await fetchList()
  }

  async function addTorrent(data: { torrent: string; options: Aria2EngineOptions }) {
    const gid = await api.addTorrent(data)
    await fetchList()
    return gid
  }

  async function addMetalink(data: AddMetalinkParams) {
    await api.addMetalink(data)
    await fetchList()
  }

  async function getTaskOption(gid: string) {
    return api.getOption({ gid })
  }

  async function changeTaskOption(payload: { gid: string; options: Aria2EngineOptions }) {
    return api.changeOption(payload)
  }

  async function removeTask(task: Aria2Task) {
    if (task.gid === currentTaskGid.value) hideTaskDetail()
    try {
      await api.removeTask({ gid: task.gid })
    } finally {
      await fetchList()
      api.saveSession()
    }
  }

  async function pauseTask(task: Aria2Task) {
    const isBT = checkTaskIsBT(task)
    const promise = isBT ? api.forcePauseTask({ gid: task.gid }) : api.pauseTask({ gid: task.gid })
    try {
      await promise
    } finally {
      await fetchList()
      api.saveSession()
    }
  }

  async function resumeTask(task: Aria2Task) {
    try {
      await api.resumeTask({ gid: task.gid })
    } finally {
      await fetchList()
      api.saveSession()
    }
  }

  async function pauseAllTask() {
    try {
      await api.pauseAllTask()
    } catch (e) {
      logger.debug('TaskStore.pauseAll', e)
      await api.forcePauseAllTask()
    } finally {
      await fetchList()
      api.saveSession()
    }
  }

  async function resumeAllTask() {
    try {
      await api.resumeAllTask()
    } finally {
      await fetchList()
      api.saveSession()
    }
  }

  async function toggleTask(task: Aria2Task) {
    const { status } = task
    if (status === TASK_STATUS.ACTIVE) return pauseTask(task)
    if (status === TASK_STATUS.WAITING || status === TASK_STATUS.PAUSED) return resumeTask(task)
  }

  function addToSeedingList(gid: string) {
    if (seedingList.value.includes(gid)) return
    seedingList.value = [...seedingList.value, gid]
  }

  function removeFromSeedingList(gid: string) {
    const idx = seedingList.value.indexOf(gid)
    if (idx === -1) return
    seedingList.value = [...seedingList.value.slice(0, idx), ...seedingList.value.slice(idx + 1)]
  }

  async function stopSeeding(gid: string) {
    return changeTaskOption({ gid, options: { seedTime: '0' } })
  }

  /** Stops ALL currently seeding tasks. Returns the count of seeding tasks found. */
  async function stopAllSeeding(): Promise<number> {
    const seeders = taskList.value.filter(checkTaskIsSeeder)
    if (seeders.length === 0) return 0
    await Promise.allSettled(seeders.map((t) => stopSeeding(t.gid)))
    return seeders.length
  }

  async function removeTaskRecord(task: Aria2Task) {
    const { gid, status } = task
    if (gid === currentTaskGid.value) hideTaskDetail()
    const { ERROR, COMPLETE, REMOVED } = TASK_STATUS
    if ([ERROR, COMPLETE, REMOVED].indexOf(status) === -1) return
    try {
      await api.removeTaskRecord({ gid })
    } finally {
      await fetchList()
    }
  }

  async function purgeTaskRecord() {
    try {
      await api.purgeTaskRecord()
    } finally {
      await fetchList()
    }
  }

  /**
   * Restarts a stopped/errored/completed task by extracting its URI(s),
   * re-submitting each as a new download, and removing the old record.
   *
   * For BT tasks: rebuilds the magnet link → single addUri call.
   * For multi-file HTTP/FTP tasks: submits each file URI separately.
   *
   * Uses rollback on partial failure: if any URI fails to submit, all
   * previously created downloads are removed so no orphan tasks remain.
   * The old stopped record is only deleted after ALL new downloads succeed.
   */
  async function restartTask(task: Aria2Task) {
    const { status, gid, dir } = task
    const { ERROR, COMPLETE, REMOVED } = TASK_STATUS
    if (status !== ERROR && status !== COMPLETE && status !== REMOVED) return

    const uris = getTaskUris(task, true) // include trackers for BT
    if (uris.length === 0) {
      throw new Error('Cannot restart: no download URIs found for this task')
    }

    // Preserve original per-task options (headers, proxy, auth, out, select-file, etc.).
    // Filter out read-only / non-portable keys that aria2 rejects on addUri.
    const NON_PORTABLE_KEYS = new Set(['followTorrent', 'followMetalink', 'pauseMetadata', 'gid'])

    const options: Record<string, string> = {}
    try {
      const orig = await api.getOption({ gid })
      for (const [k, v] of Object.entries(orig)) {
        if (!NON_PORTABLE_KEYS.has(k) && v !== '') {
          options[k] = v
        }
      }
    } catch {
      // Fallback: at minimum preserve download directory
      if (dir) options.dir = dir
    }

    // Submit each URI as a separate download, tracking created GIDs for rollback
    const createdGids: string[] = []
    try {
      for (const uri of uris) {
        const newGid = await api.addUriAtomic({ uris: [uri], options })
        createdGids.push(newGid)
      }
    } catch (e) {
      // Rollback: remove any partially created tasks
      for (const newGid of createdGids) {
        try {
          await api.removeTask({ gid: newGid })
        } catch {
          // best-effort cleanup
        }
      }
      throw e // propagate original error to caller
    }

    // All new downloads succeeded — safe to remove old stopped record
    try {
      await api.removeTaskRecord({ gid })
    } catch (e) {
      logger.debug('TaskStore.restartTask.removeRecord', e)
    }

    await fetchList()
    api.saveSession()
  }

  function saveSession() {
    api.saveSession()
  }

  async function batchResumeSelectedTasks() {
    if (selectedGidList.value.length === 0) return
    return api.batchResumeTask({ gids: selectedGidList.value })
  }

  async function batchPauseSelectedTasks() {
    if (selectedGidList.value.length === 0) return
    return api.batchPauseTask({ gids: selectedGidList.value })
  }

  async function batchRemoveTask(gids: string[]) {
    try {
      await api.batchRemoveTask({ gids })
    } finally {
      await fetchList()
      api.saveSession()
    }
  }

  return {
    currentList,
    taskDetailVisible,
    currentTaskGid,
    enabledFetchPeers,
    currentTaskItem,
    currentTaskFiles,
    currentTaskPeers,
    seedingList,
    taskList,
    selectedGidList,
    setApi,
    changeCurrentList,
    fetchList,
    selectTasks,
    selectAllTask,
    fetchItem,
    showTaskDetail,
    showTaskDetailByGid,
    hideTaskDetail,
    updateCurrentTaskItem,
    addUri,
    addTorrent,
    addMetalink,
    getTaskOption,
    changeTaskOption,
    removeTask,
    pauseTask,
    resumeTask,
    pauseAllTask,
    resumeAllTask,
    toggleTask,
    addToSeedingList,
    removeFromSeedingList,
    stopSeeding,
    stopAllSeeding,
    removeTaskRecord,
    purgeTaskRecord,
    saveSession,
    batchResumeSelectedTasks,
    batchPauseSelectedTasks,
    batchRemoveTask,
    restartTask,
    setOnTaskError,
  }
})
