/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 多件装备冲突时的仲裁排序：按领用优先级，或按送检（最近检修）日期先到先得。 */
export type ArbitrateRule = 'priority' | 'inspectDate'

/** 并发竞争领用：模拟另一个林场在同一时刻对同一装备发起领用。 */
export type CompetitorClaim = {
  id: number
  equipmentId: number
  farm: string
  priority: number
  claimedAt: string
}

/** 调拨单里单件装备的调度结果，提交后可逐条查看。 */
export type TransferLine = {
  equipmentId: number
  code: string
  name: string
  fromFarm: string
  toFarm: string
  priority: number
  inspectDate: string
  ok: boolean
  winnerFarm: string
  reason: string
}

/** 跨林场批量调拨单：要么整单落库，要么整单回退，不存在半张单。 */
export type TransferOrder = {
  id: number
  no: string
  toFarm: string
  rule: ArbitrateRule
  status: '已提交' | '已落库' | '已回退'
  lines: TransferLine[]
  createdAt: string
  confirmedAt: string
  abnormalCount: number
}

export type TransferSubmitResult = {
  ok: boolean
  message: string
  order: TransferOrder
}
