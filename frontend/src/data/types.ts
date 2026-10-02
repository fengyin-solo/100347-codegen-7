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

// ===== 跨林场批量调拨 =====

/** 多单并发领用同一装备时，管理员选择的仲裁排序规则。 */
export type ConflictRule = 'inspectDate' | 'priority'

export type TransferLineDraft = {
  equipmentId: number
  /** 本行领用优先级，默认取装备档案值，数字越小优先级越高。 */
  priority: number
}

export type TransferDraft = {
  applicant: string
  targetFarm: string
  remark: string
  lines: TransferLineDraft[]
  /** 故障注入：模拟该单第几行（1 起）落库失败，用于演示整批回退；0 表示不注入。 */
  failLineIndex?: number
}

export type TransferLineStatus =
  | '成功'
  | '冲突失败'
  | '不可调拨'
  | '落库失败'
  | '已回退'
  | '未执行'

export type TransferLineResult = {
  equipmentId: number
  equipmentCode: string
  equipmentName: string
  sourceFarm: string
  inspectDate: string
  priority: number
  status: TransferLineStatus
  message: string
}

export type TransferOrder = {
  id: string
  seq: number
  createdAt: string
  applicant: string
  targetFarm: string
  rule: ConflictRule
  remark: string
  status: '调拨成功' | '整批回退'
  totalLines: number
  successLines: number
  lines: TransferLineResult[]
}

export type EquipmentTodoType = '到货待办' | '领用冲突异常' | '落库回退异常' | '调拨校验异常'

export type EquipmentTodo = {
  id: number
  type: EquipmentTodoType
  abnormal: boolean
  resolved: boolean
  farm: string
  equipmentId: number
  equipmentName: string
  orderId: string
  content: string
  createdAt: string
}
