import {
  commitDocument,
  document as activeDocument,
  listRows,
  listTable,
  resetRows,
  saveRows,
  saveTable,
} from '@/data/local-store'
import type { StoreDraft } from '@/data/local-store'
import { FARMS, MODULE_BY_KEY } from '@/data/modules'
import { SEED_COMPETITOR_CLAIMS } from '@/data/seed'
import type {
  ActionResult,
  ArbitrateRule,
  CompetitorClaim,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  TransferLine,
  TransferOrder,
  TransferSubmitResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 装备在调拨中时已被整组调拨单占住，本页任何单条动作都不能再动它；其余动作也限定来源状态。
const EQUIPMENT_ACTION_SOURCES: Record<string, string[]> = {
  领用装备: ['可用'],
  送检登记: ['可用', '已领用'],
  报废装备: ['可用', '已领用', '待检修'],
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function listFarms(): string[] {
  return FARMS
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (key === 'equipment') {
    if (current === '调拨中') {
      return { ok: false, message: `装备正在跨林场调拨中，单条动作暂不可用，等整批落库或回退后再操作` }
    }
    const sources = EQUIPMENT_ACTION_SOURCES[action]
    if (sources && !sources.includes(current)) {
      return { ok: false, message: `装备当前为「${current}」，不能执行「${action}」` }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// ---------------------------------------------------------------------------
// 跨林场批量调拨
// ---------------------------------------------------------------------------

const EQUIPMENT_KEY = 'equipment'
const FIRETEAM_KEY = 'fireteam'
const RULE_LABEL: Record<ArbitrateRule, string> = {
  priority: '领用优先级',
  inspectDate: '送检日期',
}

function nowStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}

function todayCompact(): string {
  return nowStamp().slice(0, 10).replace(/-/g, '')
}

function priorityOf(row: EntryRow): number {
  const value = Number(row['领用优先级'])
  return Number.isFinite(value) ? value : 0
}

type ClaimSide = { farm: string; priority: number; claimedAt: string; self: boolean }

/**
 * 并发领用仲裁：同一件装备只允许一个林场成功。
 * - 按领用优先级：优先级高者得，平手时先申报者得；
 * - 按送检日期：先申报（先排送检）者得，平手时优先级高者得。
 * 仍相同按林场名兜底，保证结果确定。
 */
function arbitrate(
  ours: ClaimSide,
  others: CompetitorClaim[],
  rule: ArbitrateRule,
): ClaimSide {
  const sides: ClaimSide[] = [
    ours,
    ...others.map((item) => ({
      farm: item.farm,
      priority: item.priority,
      claimedAt: item.claimedAt,
      self: false,
    })),
  ]
  const compare = (a: ClaimSide, b: ClaimSide): number => {
    if (rule === 'priority') {
      if (b.priority !== a.priority) return b.priority - a.priority
      if (a.claimedAt !== b.claimedAt) return a.claimedAt < b.claimedAt ? -1 : 1
    } else {
      if (a.claimedAt !== b.claimedAt) return a.claimedAt < b.claimedAt ? -1 : 1
      if (b.priority !== a.priority) return b.priority - a.priority
    }
    return a.farm < b.farm ? -1 : a.farm > b.farm ? 1 : 0
  }
  return sides.sort(compare)[0]
}

/** 多件装备冲突时的处理/展示排序：按送检日期升序，或按领用优先级降序。 */
function orderLines(lines: TransferLine[], rule: ArbitrateRule, rows: EntryRow[]): TransferLine[] {
  const dateOf = (line: TransferLine) =>
    String(rows.find((row) => Number(row.id) === line.equipmentId)?.['最近检修日'] ?? '')
  const indexed = lines.map((line, index) => ({ line, index }))
  indexed.sort((a, b) => {
    if (rule === 'inspectDate') {
      const da = dateOf(a.line)
      const db = dateOf(b.line)
      if (da !== db) return da < db ? -1 : 1
    } else {
      if (b.line.priority !== a.line.priority) return b.line.priority - a.line.priority
    }
    return a.index - b.index
  })
  return indexed.map((item) => item.line)
}

export function listTransferOrders(): TransferOrder[] {
  return listTable('transferOrders')
}

export function getTransferOrder(id: number): TransferOrder | undefined {
  return listTable('transferOrders').find((order) => order.id === id)
}

export function listCompetitorClaims(): (CompetitorClaim & { code: string; name: string })[] {
  const equipment = listRows(EQUIPMENT_KEY)
  return listTable('competitorClaims').map((claim) => {
    const row = equipment.find((item) => Number(item.id) === claim.equipmentId)
    return {
      ...claim,
      code: String(row?.['装备编号'] ?? '—'),
      name: String(row?.['装备名称'] ?? '—'),
    }
  })
}

export function addCompetitorClaim(input: {
  equipmentId: number
  farm: string
  priority: number
  claimedAt: string
}): ActionResult {
  const equipment = listRows(EQUIPMENT_KEY)
  const row = equipment.find((item) => Number(item.id) === Number(input.equipmentId))
  if (!row) {
    return { ok: false, message: '没有找到这件装备' }
  }
  if (!FARMS.includes(input.farm)) {
    return { ok: false, message: '竞争林场不在林场名录里' }
  }
  if (input.farm === String(row['保管林场'])) {
    return { ok: false, message: '竞争林场不能是装备当前的保管林场' }
  }
  if (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 5) {
    return { ok: false, message: '领用优先级需为 1-5 的整数' }
  }
  if (listTable('competitorClaims').some((item) => item.equipmentId === Number(input.equipmentId))) {
    return { ok: false, message: '这件装备已有并发竞争领用，同一装备只模拟一个竞争林场' }
  }
  const claims = listTable('competitorClaims')
  const nextId = claims.reduce((max, item) => Math.max(max, item.id), 0) + 1
  saveTable('competitorClaims', [
    ...claims,
    {
      id: nextId,
      equipmentId: Number(input.equipmentId),
      farm: input.farm,
      priority: input.priority,
      claimedAt: input.claimedAt,
    },
  ])
  return { ok: true, message: `已登记 ${input.farm} 对 ${row['装备编号']} 的并发竞争领用` }
}

export function removeCompetitorClaim(id: number): ActionResult {
  const claims = listTable('competitorClaims')
  if (!claims.some((item) => item.id === id)) {
    return { ok: false, message: '没有找到这条竞争领用' }
  }
  saveTable(
    'competitorClaims',
    claims.filter((item) => item.id !== id),
  )
  return { ok: true, message: '已移除该条并发竞争领用' }
}

export function submitTransferBatch(input: {
  toFarm: string
  rule: ArbitrateRule
  equipmentIds: number[]
}): TransferSubmitResult {
  const toFarm = input.toFarm.trim()
  if (!FARMS.includes(toFarm)) {
    return {
      ok: false,
      message: '请先选择目标林场',
      order: blankOrder(toFarm, input.rule),
    }
  }
  const ids = [...new Set(input.equipmentIds.map(Number))]
  if (ids.length === 0) {
    return {
      ok: false,
      message: '请至少勾选一件器材再整组提交',
      order: blankOrder(toFarm, input.rule),
    }
  }

  const stamp = nowStamp()
  // 先在草稿上完成全部变更与校验，任何一件失败都不调用 commitDocument：
  // 存储一字未写，从根上杜绝半张消防装备调拨单。
  const draft: StoreDraft = JSON.parse(JSON.stringify(activeDocument()))
  const equipmentRows = draft.entries[EQUIPMENT_KEY] as EntryRow[]
  const competitors = draft.tables.competitorClaims as CompetitorClaim[]
  const lines: TransferLine[] = []

  for (const equipmentId of ids) {
    const row = equipmentRows.find((item) => Number(item.id) === equipmentId)
    if (!row) {
      lines.push({
        equipmentId,
        code: '—',
        name: '—',
        fromFarm: '—',
        toFarm,
        priority: 0,
        inspectDate: '—',
        ok: false,
        winnerFarm: '—',
        reason: '装备记录不存在，无法落库',
      })
      continue
    }
    const base = {
      equipmentId,
      code: String(row['装备编号']),
      name: String(row['装备名称']),
      fromFarm: String(row['保管林场']),
      toFarm,
      priority: priorityOf(row),
      inspectDate: String(row['最近检修日']),
    }
    const status = String(row.status)
    if (status !== '可用') {
      lines.push({
        ...base,
        ok: false,
        winnerFarm: base.fromFarm,
        reason: `装备当前为「${status}」，只有「可用」装备能调拨，落库失败`,
      })
      continue
    }
    if (base.fromFarm === toFarm) {
      lines.push({
        ...base,
        ok: false,
        winnerFarm: toFarm,
        reason: '保管林场就是目标林场，不属于跨林场调拨，整批驳回',
      })
      continue
    }
    const ours: ClaimSide = {
      farm: toFarm,
      priority: priorityOf(row),
      claimedAt: stamp,
      self: true,
    }
    const others = competitors.filter((item) => item.equipmentId === equipmentId)
    const winner = arbitrate(ours, others, input.rule)
    if (!winner.self) {
      lines.push({
        ...base,
        ok: false,
        winnerFarm: winner.farm,
        reason:
          `与${others.map((item) => item.farm).join('、')}并发领用同一件装备，` +
          `按${RULE_LABEL[input.rule]}仲裁由${winner.farm}获得，本场未抢到，落库失败`,
      })
      continue
    }
    lines.push({
      ...base,
      ok: true,
      winnerFarm: toFarm,
      reason:
        others.length > 0
          ? `并发领用仲裁胜出（按${RULE_LABEL[input.rule]}），已占库等待整批落库确认`
          : '无并发竞争，已占库等待整批落库确认',
    })
    // 暂存在草稿上：只有全部成功才会随单次写入落库；有一件失败就整批丢弃。
    row.status = '调拨中'
    row['装备状态'] = '调拨中'
  }

  const ordered = orderLines(lines, input.rule, equipmentRows)
  const failed = ordered.filter((line) => !line.ok)
  const orders = listTable('transferOrders')
  const nextId = orders.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const seq = orders.filter((item) => item.no.includes(todayCompact())).length + 1
  const order: TransferOrder = {
    id: nextId,
    no: `DB-${todayCompact()}-${String(seq).padStart(3, '0')}`,
    toFarm,
    rule: input.rule,
    status: failed.length > 0 ? '已回退' : '已提交',
    lines: ordered,
    createdAt: stamp,
    confirmedAt: '',
    abnormalCount: failed.length,
  }

  if (failed.length > 0) {
    // 整批回退：草稿（含前面已改成「调拨中」的装备）整体丢弃，只持久化回退单供逐条查看。
    saveTable('transferOrders', [...orders, order])
    return {
      ok: false,
      message:
        `${failed.length} 件装备落库失败（共 ${ordered.length} 件），整批已回退，未改动任何装备库存；` +
        `失败明细见调度结果，运营异常量 +${failed.length}`,
      order,
    }
  }

  // 全部成功：装备占库与调拨单在同一次写入里提交，要么都成功要么都不动。
  commitDocument((live) => {
    live.entries[EQUIPMENT_KEY] = equipmentRows
    live.tables.transferOrders = [...live.tables.transferOrders, order]
  })
  return {
    ok: true,
    message: `整组 ${ordered.length} 件器材提交成功，装备已占为「调拨中」，确认落库后完成跨林场交接`,
    order,
  }
}

export function confirmLanding(
  orderId: number,
  options: { simulateFail?: boolean } = {},
): TransferSubmitResult {
  const orders = listTable('transferOrders')
  const index = orders.findIndex((item) => item.id === orderId)
  const order = orders[index]
  if (!order) {
    return { ok: false, message: '没有找到这张调拨单', order: blankOrder('', 'priority') }
  }
  if (order.status !== '已提交') {
    return { ok: false, message: `调拨单当前为「${order.status}」，不能确认落库`, order }
  }

  const stamp = nowStamp()
  const draft: StoreDraft = JSON.parse(JSON.stringify(activeDocument()))
  const equipmentRows = draft.entries[EQUIPMENT_KEY] as EntryRow[]
  const teamRows = draft.entries[FIRETEAM_KEY] as EntryRow[]
  const landed: TransferLine[] = []
  let failureReason = ''

  for (const line of order.lines) {
    const row = equipmentRows.find((item) => Number(item.id) === line.equipmentId)
    if (
      options.simulateFail &&
      line.equipmentId === order.lines[order.lines.length - 1].equipmentId
    ) {
      failureReason = `装备 ${line.code} 落库时写入失败（模拟）`
      landed.push({ ...line, ok: false, winnerFarm: line.fromFarm, reason: `${failureReason}，整批回退` })
      continue
    }
    if (!row || String(row.status) !== '调拨中' || String(row['保管林场']) !== line.fromFarm) {
      failureReason = `装备 ${line.code} 状态已变化，不符合落库条件`
      landed.push({ ...line, ok: false, winnerFarm: line.fromFarm, reason: `${failureReason}，整批回退` })
      continue
    }
    row.status = '已领用'
    row['装备状态'] = '已领用'
    row['保管林场'] = order.toFarm
    landed.push({ ...line, ok: true, reason: '已落库到目标林场，器材待办已下发到扑火队伍' })
  }

  if (failureReason) {
    // 确认阶段同样整批回退：装备维持「调拨中」，队伍待办不动，调拨单保留为已提交供重试。
    return {
      ok: false,
      message: `${failureReason}：本批未落库任何一件，已整批回退，装备保持「调拨中」，不会留下半张调拨单`,
      order: { ...order, lines: landed },
    }
  }

  // 落库后联动扑火队伍器材待办：目标林场的每支队伍按到库件数增加待办。
  for (const team of teamRows) {
    if (String(team['所属林场']) === order.toFarm) {
      const todo = Number(team['器材待办'] ?? 0) + landed.length
      team['器材待办'] = todo
      if (todo > 0) {
        team.pending = true
      }
    }
  }

  const confirmed: TransferOrder = {
    ...order,
    status: '已落库',
    lines: landed,
    confirmedAt: stamp,
    abnormalCount: 0,
  }
  const nextOrders = [...orders]
  nextOrders[index] = confirmed
  commitDocument((live) => {
    live.entries[EQUIPMENT_KEY] = equipmentRows
    live.entries[FIRETEAM_KEY] = teamRows
    live.tables.transferOrders = nextOrders
  })
  return {
    ok: true,
    message: `调拨单 ${order.no} 已全部落库到${order.toFarm}，${landed.length} 件器材待办已同步给该林场扑火队伍`,
    order: confirmed,
  }
}

/** 回到调拨演示的初始状态：装备、队伍、调拨单、竞争领用全部重置。 */
export function resetTransferDemo(): void {
  resetRows(EQUIPMENT_KEY)
  resetRows(FIRETEAM_KEY)
  commitDocument((draft) => {
    draft.tables.transferOrders = []
    draft.tables.competitorClaims = JSON.parse(JSON.stringify(SEED_COMPETITOR_CLAIMS))
  })
}

function blankOrder(toFarm: string, rule: ArbitrateRule): TransferOrder {
  return {
    id: 0,
    no: '',
    toFarm,
    rule,
    status: '已回退',
    lines: [],
    createdAt: '',
    confirmedAt: '',
    abnormalCount: 0,
  }
}

// ---------------------------------------------------------------------------

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const doc = activeDocument()
  const rows = doc.entries
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const orders = doc.tables.transferOrders
  const transferRow = {
    name: '消防装备调拨',
    created: orders.length,
    pending: orders.filter((order) => order.status === '已提交').length,
    abnormal: orders.reduce((sum, order) => sum + order.abnormalCount, 0),
  }
  const allModules = [...modules, transferRow]
  const cards = [
    { label: '业务模块', value: allModules.length },
    { label: '登记总量', value: allModules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: allModules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: allModules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules: allModules }
}
