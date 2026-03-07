# Task2 周可用时段自动分配修复

## 问题背景
- weekly slots 编辑器存在多行新增失效问题：新增第二条后会被折叠，导致用户看起来“只能添加星期一”。
- 周视图缺少 slot 级可见信息：任务虽已按 weekly slots 容量分配，但界面无法看出任务落在哪个时间段。

## 本轮修复点
- 修复 weekly slots 编辑器链路：支持多条行新增、逐行独立 weekday/start/end 编辑、保存后持久化并可刷新回填。
- 在周视图补充最小 slot 标签展示：
  - 日期列头显示当日配置的 slot 标签（如 `09:00-11:00`）。
  - 任务卡显示对应 slot 标签，便于识别任务落位。
- 兼容旧 assignedDays：保持 `assignedDays[date] = { subtaskIds, hours }` 结构不变，仅附加最小字段用于展示（不破坏旧数据读取）。

## 关键函数与数据点
- 设置编辑器链路：
  - `renderWeeklySlotEditor`
  - `addWeeklySlotRow`
  - `collectWeeklySlotEditorRows`
  - `saveSettingsHandler`
- 周视图展示链路：
  - `renderWeek`
  - `buildDayMap`
- 分配与展示桥接数据：
  - `slotBySubtaskId`（挂在 `assignedDays[date]` 下，按 subtaskId 记录 slot 标签）
  - `appendAssignment` 中写入 slot 标签

## 验收结果
- 可连续添加 3 条 weeklyAvailability。
- 可设置为：
  - 周一 `09:00-11:00`
  - 周三 `14:00-16:00`
  - 周五 `19:00-20:30`
- 保存后 `JSON.parse(localStorage.getItem('ddl_settings')).weeklyAvailability` 为 3 条。
- 刷新页面后重新打开设置，3 条记录仍可回显。
- 周视图可见 slot 标签（列头与任务卡），能看出任务落在配置时段。

## 不变更项
- 不改后端接口。
- 不改 Task 主结构与既有存储键名。
- 不改估时修正相关逻辑（multiplier 链路保持原样）。
- 不引入新依赖。
