import { SEED_COMPETITOR_CLAIMS, SEED_ROWS } from './seed'
import type { CompetitorClaim, EntryRow, TransferOrder } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：装备新增领用优先级/调拨中状态、扑火队伍新增器材待办、新增调拨单与并发竞争领用。
const STORAGE_KEY = 'forest-fire-patrol:entries:v2'

/** 调拨单、竞争领用这类非 EntryRow[] 数据集，和业务表放在同一个文档里一起持久化。 */
export type SideTables = {
  transferOrders: TransferOrder[]
  competitorClaims: CompetitorClaim[]
}

export type StoreDraft = {
  entries: Record<string, EntryRow[]>
  tables: SideTables
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function fallbackDocument(): StoreDraft {
  return {
    entries: clone(SEED_ROWS),
    tables: {
      transferOrders: [],
      competitorClaims: clone(SEED_COMPETITOR_CLAIMS),
    },
  }
}

function readStorage(): StoreDraft {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallbackDocument()
  }
  const fallback = fallbackDocument()
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoreDraft>
    return {
      entries: { ...fallback.entries, ...(parsed.entries ?? {}) },
      tables: { ...fallback.tables, ...(parsed.tables ?? {}) },
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: StoreDraft | null = null

export function document(): StoreDraft {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return document().entries
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commitDocument((draft) => {
    draft.entries[key] = rows
  })
}

export function listTable<K extends keyof SideTables>(key: K): SideTables[K] {
  return document().tables[key]
}

export function saveTable<K extends keyof SideTables>(key: K, value: SideTables[K]): void {
  commitDocument((draft) => {
    draft.tables[key] = value
  })
}

/**
 * 一次原子提交：所有变更在内存草稿上完成，最后只写一次存储。
 * 回调里抛错就整体放弃，草稿上的改动一个字都不会落库——用于调拨整批回退，
 * 保证不会出现「有的装备改了、有的没改」的半张调拨单。
 */
export function commitDocument(mutate: (draft: StoreDraft) => void): void {
  const draft = clone(document())
  mutate(draft)
  cache = draft
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 丢弃内存缓存，下次读取时重新从 localStorage 播种（测试用）。 */
export function reloadDocument(): void {
  cache = null
}

export function storageKey(): string {
  return STORAGE_KEY
}
