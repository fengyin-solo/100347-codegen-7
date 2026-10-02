<template>
  <section class="page" data-module="equipment-transfer">
    <header class="page-head">
      <div>
        <h2>跨林场批量调拨台</h2>
        <p class="page-desc">
          批量勾选多件器材整组一次提交，并发领用同一装备只允许一个林场成功；任一装备落库失败整批回退，
          绝不下发半张调拨单。冲突排序可由管理员按领用优先级或送检日期切换。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetDemo">重置调拨演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">已提交待落库</span>
        <strong class="stat-value">{{ pendingOrders }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已落库调拨单</span>
        <strong class="stat-value">{{ landedOrders }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">整批回退单</span>
        <strong class="stat-value">{{ rolledOrders }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">调度异常量（冲突/失败件次）</span>
        <strong class="stat-value">{{ abnormalTotal }}</strong>
      </article>
    </div>

    <section class="transfer-panel">
      <div class="transfer-controls">
        <label class="filter-item">
          <span>调入目标林场</span>
          <select v-model="toFarm" @change="lastResult = null">
            <option value="" disabled>请选择目标林场</option>
            <option v-for="farm in farms" :key="farm" :value="farm">{{ farm }}</option>
          </select>
        </label>
        <div class="rule-box">
          <span class="rule-title">多件装备冲突时的排序规则（管理员决定）</span>
          <label class="rule-option">
            <input v-model="rule" type="radio" value="priority" />
            <span>按领用优先级</span>
            <small>优先级高的林场先获得；同级先申报先得。冲突清单按优先级降序排列</small>
          </label>
          <label class="rule-option">
            <input v-model="rule" type="radio" value="inspectDate" />
            <span>按送检日期</span>
            <small>先申报（先排送检）的林场先获得；同申报时刻优先级高者得。冲突清单按最近检修日升序排列</small>
          </label>
        </div>
        <div class="submit-box">
          <button class="btn primary" type="button" @click="submitBatch">整组提交调拨（{{ selectedIds.length }} 件）</button>
          <p class="rule-hint">提交后所有器材作为一张调拨单一次性处理，任一件失败即整批回退。</p>
        </div>
      </div>

      <h3 class="panel-subtitle">器材选择（仅「可用」装备可勾选）</h3>
      <div class="filter-bar">
        <label class="filter-item">
          <span>按装备名称/编号检索</span>
          <input v-model="keyword" placeholder="如 风力灭火机 / EQUI-1001" />
        </label>
        <label class="filter-item">
          <span>按保管林场筛选</span>
          <select v-model="farmFilter">
            <option value="">全部林场</option>
            <option v-for="farm in farms" :key="farm" :value="farm">{{ farm }}</option>
          </select>
        </label>
        <button class="btn ghost" type="button" @click="clearSelection">清空勾选</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th class="col-check">选择</th>
            <th>装备编号</th>
            <th>装备名称</th>
            <th>装备类型</th>
            <th>保管林场</th>
            <th>领用优先级</th>
            <th>最近检修日</th>
            <th>当前状态</th>
            <th>并发竞争</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visibleEquipment" :key="String(row.id)">
            <td>
              <input
                :checked="isSelected(Number(row.id))"
                :disabled="String(row.status) !== '可用'"
                type="checkbox"
                @change="toggle(Number(row.id))"
              />
            </td>
            <td>{{ row['装备编号'] }}</td>
            <td>{{ row['装备名称'] }}</td>
            <td>{{ row['装备类型'] }}</td>
            <td>{{ row['保管林场'] }}</td>
            <td>{{ row['领用优先级'] }}</td>
            <td>{{ row['最近检修日'] }}</td>
            <td>{{ row.status }}</td>
            <td>
              <span v-if="competitorOf(Number(row.id))" class="conflict-tag">
                {{ competitorOf(Number(row.id))?.farm }} 同时领用
              </span>
              <span v-else class="muted-text">无</span>
            </td>
          </tr>
          <tr v-if="!visibleEquipment.length">
            <td :colspan="9" class="empty-state">当前筛选条件下没有装备</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="claim-panel">
      <h3 class="panel-subtitle">并发领用模拟（其它林场同时刻对同一装备发起领用）</h3>
      <p class="rule-hint">
        纯前端环境没有真实并发，这里预置竞争领用：整组提交时对每件装备做仲裁，同一装备只有一个林场成功。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>装备编号</th>
            <th>装备名称</th>
            <th>竞争林场</th>
            <th>竞争方优先级</th>
            <th>申报时刻</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="claim in competitorClaims" :key="claim.id">
            <td>{{ claim.code }}</td>
            <td>{{ claim.name }}</td>
            <td>{{ claim.farm }}</td>
            <td>{{ claim.priority }}</td>
            <td>{{ claim.claimedAt }}</td>
            <td>
              <button class="link" type="button" @click="dropClaim(claim.id)">移除</button>
            </td>
          </tr>
          <tr v-if="!competitorClaims.length">
            <td :colspan="6" class="empty-state">暂无竞争领用</td>
          </tr>
        </tbody>
      </table>
      <form class="filter-bar claim-form" @submit.prevent="addClaim">
        <label class="filter-item">
          <span>装备</span>
          <select v-model.number="claimForm.equipmentId">
            <option :value="0" disabled>选择装备</option>
            <option
              v-for="row in claimableEquipment"
              :key="String(row.id)"
              :value="Number(row.id)"
            >
              {{ row['装备编号'] }} · {{ row['装备名称'] }}（{{ row['保管林场'] }}）
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>竞争林场</span>
          <select v-model="claimForm.farm">
            <option value="" disabled>选择林场</option>
            <option v-for="farm in competitorFarms(Number(claimForm.equipmentId))" :key="farm" :value="farm">
              {{ farm }}
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>优先级</span>
          <input v-model.number="claimForm.priority" max="5" min="1" type="number" />
        </label>
        <label class="filter-item">
          <span>申报时刻</span>
          <input v-model="claimForm.claimedAt" type="datetime-local" />
        </label>
        <button class="btn primary" type="submit">登记竞争领用</button>
      </form>
    </section>

    <section class="order-panel">
      <h3 class="panel-subtitle">调拨单与逐条调度结果</h3>
      <div v-if="lastResult" :class="['result-banner', lastResult.ok ? 'ok' : 'fail']">
        <strong>{{ lastResult.ok ? '提交成功' : '整批回退' }}</strong>
        <span>{{ lastResult.message }}</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>调拨单号</th>
            <th>目标林场</th>
            <th>排序规则</th>
            <th>件数</th>
            <th>成功</th>
            <th>失败</th>
            <th>状态</th>
            <th>提交时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in orders" :key="order.id" :class="['order-row', order.status === '已回退' ? 'row-fail' : '']">
            <td>{{ order.no }}</td>
            <td>{{ order.toFarm }}</td>
            <td>{{ ruleLabel(order.rule) }}</td>
            <td>{{ order.lines.length }}</td>
            <td>{{ order.lines.filter((line) => line.ok).length }}</td>
            <td>{{ order.abnormalCount }}</td>
            <td>
              <span :class="['status-pill', pillClass(order.status)]">{{ order.status }}</span>
            </td>
            <td>{{ order.createdAt }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="toggleOrder(order.id)">
                {{ expanded.has(order.id) ? '收起明细' : '逐条查看' }}
              </button>
              <button
                v-if="order.status === '已提交'"
                class="link"
                type="button"
                @click="confirmOrder(order.id, false)"
              >
                确认落库
              </button>
              <button
                v-if="order.status === '已提交'"
                class="link danger"
                type="button"
                @click="confirmOrder(order.id, true)"
              >
                模拟落库失败
              </button>
            </td>
          </tr>
          <tr v-if="!orders.length">
            <td :colspan="9" class="empty-state">还没有调拨单，勾选器材后整组提交</td>
          </tr>
        </tbody>
      </table>

      <div v-for="order in expandedOrders" :key="`detail-${order.id}`" class="line-detail">
        <h4>
          {{ order.no }} · 调度明细
          <span class="muted-text">（冲突处理顺序按{{ ruleLabel(order.rule) }}排列）</span>
        </h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>装备编号</th>
              <th>装备名称</th>
              <th>调出林场</th>
              <th>调入林场</th>
              <th>优先级</th>
              <th>最近检修日</th>
              <th>调度结果</th>
              <th>获得方</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, i) in order.lines" :key="line.equipmentId" :class="line.ok ? '' : 'line-fail'">
              <td>{{ i + 1 }}</td>
              <td>{{ line.code }}</td>
              <td>{{ line.name }}</td>
              <td>{{ line.fromFarm }}</td>
              <td>{{ line.toFarm }}</td>
              <td>{{ line.priority }}</td>
              <td>{{ line.inspectDate }}</td>
              <td>
                <span :class="['status-pill', line.ok ? 'pill-ok' : 'pill-fail']">
                  {{ line.ok ? '成功' : '失败' }}
                </span>
              </td>
              <td>{{ line.winnerFarm }}</td>
              <td>{{ line.reason }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="order.confirmedAt" class="muted-text">确认落库时间：{{ order.confirmedAt }}</p>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import {
  addCompetitorClaim,
  confirmLanding,
  listCompetitorClaims,
  listFarms,
  listTransferOrders,
  removeCompetitorClaim,
  resetTransferDemo,
  submitTransferBatch,
} from '@/api/local-service'
import { listRows } from '@/data/local-store'
import type { ArbitrateRule, TransferOrder, TransferSubmitResult } from '@/data/types'

const farms = listFarms()
const toFarm = ref('')
const rule = ref<ArbitrateRule>('priority')
const selectedIds = ref<number[]>([])
const keyword = ref('')
const farmFilter = ref('')

const orders = ref<TransferOrder[]>([])
const competitorClaims = ref(listCompetitorClaims())
const expanded = ref(new Set<number>())
const lastResult = ref<TransferSubmitResult | null>(null)

const claimForm = reactive({
  equipmentId: 0,
  farm: '',
  priority: 3,
  claimedAt: '2026-10-02T09:00',
})

const equipment = computed(() => listRows('equipment'))
const visibleEquipment = computed(() =>
  equipment.value.filter((row) => {
    const text = `${row['装备编号']} ${row['装备名称']}`
    const hitKeyword = keyword.value.trim() === '' || text.includes(keyword.value.trim())
    const hitFarm = farmFilter.value === '' || String(row['保管林场']) === farmFilter.value
    return hitKeyword && hitFarm
  }),
)
const claimableEquipment = computed(() =>
  equipment.value.filter(
    (row) =>
      !competitorClaims.value.some(
        (claim) => claim.equipmentId === Number(row.id),
      ),
  ),
)
const expandedOrders = computed(() =>
  orders.value.filter((order) => expanded.value.has(order.id)),
)
const pendingOrders = computed(() => orders.value.filter((order) => order.status === '已提交').length)
const landedOrders = computed(() => orders.value.filter((order) => order.status === '已落库').length)
const rolledOrders = computed(() => orders.value.filter((order) => order.status === '已回退').length)
const abnormalTotal = computed(() =>
  orders.value.reduce((sum, order) => sum + order.abnormalCount, 0),
)

function isSelected(id: number) {
  return selectedIds.value.includes(id)
}

function toggle(id: number) {
  if (isSelected(id)) {
    selectedIds.value = selectedIds.value.filter((item) => item !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}

function clearSelection() {
  selectedIds.value = []
}

function competitorOf(equipmentId: number) {
  return competitorClaims.value.find((claim) => claim.equipmentId === equipmentId)
}

function competitorFarms(equipmentId: number) {
  const row = equipment.value.find((item) => Number(item.id) === equipmentId)
  const current = row ? String(row['保管林场']) : ''
  return farms.filter((farm) => farm !== current)
}

function ruleLabel(value: ArbitrateRule) {
  return value === 'priority' ? '领用优先级' : '送检日期'
}

function pillClass(status: string) {
  if (status === '已落库') return 'pill-ok'
  if (status === '已回退') return 'pill-fail'
  return 'pill-wait'
}

function toggleOrder(id: number) {
  const next = new Set(expanded.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  expanded.value = next
}

function reloadAux() {
  orders.value = listTransferOrders()
  competitorClaims.value = listCompetitorClaims()
}

function submitBatch() {
  const result = submitTransferBatch({
    toFarm: toFarm.value,
    rule: rule.value,
    equipmentIds: selectedIds.value,
  })
  lastResult.value = result
  reloadAux()
  if (result.ok) {
    selectedIds.value = []
    expanded.value = new Set([result.order.id])
  } else if (result.order.id) {
    expanded.value = new Set([result.order.id])
  }
}

function confirmOrder(id: number, simulateFail: boolean) {
  const result = confirmLanding(id, { simulateFail })
  lastResult.value = result
  reloadAux()
  if (result.ok) {
    expanded.value = new Set([id])
  }
}

function addClaim() {
  const claimedAt = claimForm.claimedAt.replace('T', ' ') + ':00'
  const result = addCompetitorClaim({
    equipmentId: Number(claimForm.equipmentId),
    farm: claimForm.farm,
    priority: Number(claimForm.priority),
    claimedAt,
  })
  if (result.ok) {
    claimForm.equipmentId = 0
    claimForm.farm = ''
    reloadAux()
  }
  lastResult.value = {
    ok: result.ok,
    message: result.message,
    order: { ...blankOrder() },
  }
}

function dropClaim(id: number) {
  const result = removeCompetitorClaim(id)
  lastResult.value = { ok: result.ok, message: result.message, order: blankOrder() }
  reloadAux()
}

function resetDemo() {
  resetTransferDemo()
  selectedIds.value = []
  expanded.value = new Set()
  lastResult.value = null
  reloadAux()
}

function blankOrder(): TransferOrder {
  return {
    id: 0,
    no: '',
    toFarm: '',
    rule: 'priority',
    status: '已回退',
    lines: [],
    createdAt: '',
    confirmedAt: '',
    abnormalCount: 0,
  }
}

reloadAux()
</script>
