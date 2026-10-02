import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都在。
// 升级版本号会让旧缓存失效，回到最新示例数据。
const STORAGE_KEY = 'forest-fire-patrol:entries:v2'

// 调拨领域自己的集合：和业务记录存在同一个 localStorage 键里，
// 这样一次 setItem 就能把「装备落库 + 调拨单 + 待办」原子写下去。
const EXTRA_COLLECTIONS = ['transferOrders', 'equipmentTodos'] as const
type ExtraKey = (typeof EXTRA_COLLECTIONS)[number]

type StoreState = Record<string, unknown>

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedState(): StoreState {
  const state: StoreState = clone(SEED_ROWS) as StoreState
  for (const key of EXTRA_COLLECTIONS) {
    state[key] = []
  }
  return state
}

function readStorage(): StoreState {
  const fallback = seedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as StoreState
    // 旧版本缺字段时用种子补齐，避免调拨集合读到 undefined。
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: StoreState | null = null

function state(): StoreState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/**
 * 原子提交：先在内存副本上打补丁，再一次性写入 localStorage。
 * 序列化或写入抛错时丢弃副本、保留原状态，调用方据此整批回退，
 * 绝不出现「装备改了、调拨单没写」的半张单。
 */
export function commitAll(patches: Record<string, unknown>): void {
  const current = state()
  const next: StoreState = { ...current, ...clone(patches) }
  const raw = JSON.stringify(next)
  if (typeof window !== 'undefined' && window.localStorage) {
    // setItem 本身也可能失败（配额/隐私模式），失败时不能污染内存态。
    window.localStorage.setItem(STORAGE_KEY, raw)
  }
  cache = next
}

export function allRows(): Record<string, EntryRow[]> {
  return state() as Record<string, EntryRow[]>
}

export function listRows(key: string): EntryRow[] {
  const rows = state()[key]
  return Array.isArray(rows) ? (rows as EntryRow[]) : []
}

export function listCollection<T>(key: ExtraKey): T[] {
  const rows = state()[key]
  return Array.isArray(rows) ? (rows as T[]) : []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commitAll({ [key]: rows })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 恢复全部调拨演示数据（装备回到示例状态，清空调拨单与待办）。 */
export function resetDemoData(): void {
  commitAll(seedState())
}

export function storageKey(): string {
  return STORAGE_KEY
}
