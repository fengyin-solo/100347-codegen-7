// 业务规则端到端验证：用 esbuild 打包后在 Node 跑，localStorage 用内存实现。
import {
  confirmLanding,
  listTransferOrders,
  loadOverview,
  resetTransferDemo,
  runAction,
  submitTransferBatch,
} from '@/api/local-service'
import { listRows, reloadDocument, storageKey } from '@/data/local-store'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    console.error(`  ✗ ${name} ${extra}`)
  }
}
const eq = (id: number) => listRows('equipment').find((r) => Number(r.id) === id)!
const team = (id: number) => listRows('fireteam').find((r) => Number(r.id) === id)!

function reset() {
  globalThis.__STORE__ = {}
  reloadDocument()
  resetTransferDemo()
}

// ---- 场景 1：按领用优先级，部分竞争失败 → 整批回退，库存一行不动 ----------
console.log('场景1：优先级仲裁 + 整批回退')
reset()
const r1 = submitTransferBatch({ toFarm: '红枫林场', rule: 'priority', equipmentIds: [1, 2, 3, 5] })
check('提交返回失败', r1.ok === false, r1.message)
check('生成已回退调拨单', r1.order.status === '已回退')
check('异常件次=1（仅 eq1 竞争失败）', r1.order.abnormalCount === 1, `got ${r1.order.abnormalCount}`)
check('逐条结果共4条', r1.order.lines.length === 4)
check('eq1 由竞争方碧溪(P4)赢过本场红枫(P3)', r1.order.lines.find((l) => l.equipmentId === 1)?.winnerFarm === '碧溪林场')
check('eq2 本场P4赢过竞争方碧溪P2', r1.order.lines.find((l) => l.equipmentId === 2)?.ok === true)
check('eq3 无竞争直接占库成功', r1.order.lines.find((l) => l.equipmentId === 3)?.ok === true)
check('eq5 本场P5赢过竞争方青松P3', r1.order.lines.find((l) => l.equipmentId === 5)?.ok === true)
const r1b = submitTransferBatch({ toFarm: '碧溪林场', rule: 'priority', equipmentIds: [7] })
check('eq7 单批验证：竞争方云岭(P5)赢过本场碧溪(装备P2)', r1b.order.lines[0]?.winnerFarm === '云岭林场')
check('回退后 eq1 仍为可用', String(eq(1).status) === '可用')
check('回退后 eq5（仲裁胜出）也不留半成品，仍为可用', String(eq(5).status) === '可用')
check('回退后 eq5 保管林场仍是碧溪林场', String(eq(5)['保管林场']) === '碧溪林场')
const stored1 = JSON.parse(window.localStorage.getItem(storageKey()) ?? '{}')
check('落库存储中所有装备都不是调拨中', stored1.entries.equipment.every((r: any) => r.status !== '调拨中'))
check('回退单已持久化供逐条查看', stored1.tables.transferOrders.length === 2)
check('运营异常量含回退件次(+2)', loadOverview().cards[3].value >= 2)

// ---- 场景 2：同样选择切到「按送检日期」，先申报先得 → 本场全部输掉 ---------
console.log('场景2：送检日期规则（竞争方申报更早）')
reset()
const r2 = submitTransferBatch({ toFarm: '红枫林场', rule: 'inspectDate', equipmentIds: [2, 5, 12] })
check('按送检日期整批回退', r2.ok === false && r2.order.status === '已回退')
check('三件全输给更早申报的竞争方', r2.order.abnormalCount === 3, `got ${r2.order.abnormalCount}`)
check('冲突清单按最近检修日升序（eq12 09-20 最晚在最后）', r2.order.lines[2].equipmentId === 12)
check('装备库存保持可用', [2, 5, 12].every((id) => String(eq(id).status) === '可用'))

// ---- 场景 3：按优先级全部仲裁胜出 → 提交占库，再确认落库联动待办 ----------
console.log('场景3：整组提交成功 + 确认落库联动')
reset()
const beforeTodo = Number(team(6)['器材待办']) // 红枫应急队
const picked3 = [3, 4, 6]
const r3 = submitTransferBatch({ toFarm: '红枫林场', rule: 'priority', equipmentIds: picked3 })
check('提交成功', r3.ok === true, r3.message)
check('调拨单已提交待落库', r3.order.status === '已提交')
check('三件装备占为调拨中', picked3.every((id) => String(eq(id).status) === '调拨中'))
check('待落库期间保管林场不变', String(eq(6)['保管林场']) === '碧溪林场')
const c3 = confirmLanding(r3.order.id)
check('确认落库成功', c3.ok === true, c3.message)
check('落库后装备为已领用', picked3.every((id) => String(eq(id).status) === '已领用'))
check('落库后保管林场改为红枫林场', picked3.every((id) => String(eq(id)['保管林场']) === '红枫林场'))
check('红枫队伍器材待办 +3', Number(team(6)['器材待办']) === beforeTodo + 3, `got ${team(6)['器材待办']}`)
check('待办>0 的队伍标记 pending', team(6).pending === true)
check('调拨单状态已落库', listTransferOrders()[0].status === '已落库')
check('本场景落库成功，调拨模块异常量为0', listTransferOrders().reduce((s, o) => s + o.abnormalCount, 0) === 0)

// ---- 场景 4：确认落库时最后一件写入失败 → 整批回退，不留半张单 -----------
console.log('场景4：确认落库失败整批回退')
reset()
const picked4 = [4, 10]
const r4 = submitTransferBatch({ toFarm: '碧溪林场', rule: 'priority', equipmentIds: picked4 })
check('提交成功（无冲突）', r4.ok === true, r4.message)
const c4 = confirmLanding(r4.order.id, { simulateFail: true })
check('确认返回失败', c4.ok === false)
check('装备保持调拨中，未产生半张单', picked4.every((id) => String(eq(id).status) === '调拨中'))
const order4 = listTransferOrders().find((o) => o.id === r4.order.id)!
check('调拨单仍为已提交，可重试', order4.status === '已提交')
const c4b = confirmLanding(r4.order.id)
check('重试确认落库成功', c4b.ok === true)
check('重试后全部已领用', picked4.every((id) => String(eq(id).status) === '已领用'))

// ---- 场景 5：防护类 -------------------------------------------------------
console.log('场景5：其它防护')
reset()
const r5 = submitTransferBatch({ toFarm: '碧溪林场', rule: 'priority', equipmentIds: [6] })
check('同林场调拨被驳回（eq6 就在碧溪）', r5.ok === false && r5.order.abnormalCount === 1)
const r6 = submitTransferBatch({ toFarm: '红枫林场', rule: 'priority', equipmentIds: [8] })
check('待检修装备不可调拨', r6.ok === false && /待检修/.test(r6.order.lines[0].reason))
check('未勾选任何装备时拦截', submitTransferBatch({ toFarm: '红枫林场', rule: 'priority', equipmentIds: [] }).ok === false)
const lock = submitTransferBatch({ toFarm: '红枫林场', rule: 'priority', equipmentIds: [2] })
check('占库提交成功', lock.ok === true)
const blocked = runAction('equipment', 2, '送检登记')
check('调拨中装备拒绝单条动作', blocked.ok === false && /调拨中/.test(blocked.message))

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
