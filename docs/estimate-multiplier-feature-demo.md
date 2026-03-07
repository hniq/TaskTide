# TaskTide「估时修正系数」功能展示文档

## 1. 验收范围
- multiplier 计算：基于 `ddl_tasks` 中历史 `subtasks` 的 `actualHours / estimatedHours`
- 规则校验：仅统计 `actualHours > 0 && estimatedHours > 0`，均值后 `clamp(0.7, 2.5)`，无样本默认 `1`
- 应用场景：
  - AI 返回 subtasks 后修正 `subtask.estimatedHours`
  - 自动排期时，仅无 subtasks 的整任务（`__whole_`）使用 multiplier
- 非目标场景回归：日历拖拽/移除不重复放大工时
- 非回归补充：保留 `#fTitle` 的 Tab 一键提示词功能

## 2. 验收环境与执行方式
- 时间：2026-03-07
- 页面地址：`http://127.0.0.1:4173/index.html`
- 浏览器：Microsoft Edge（headless）
- 自动化：Playwright
- 执行脚本：`scripts/run_estimate_acceptance.js`
- 结果文件：`artifacts/estimate-multiplier/results.json`

## 3. 验收结果总览
- 总用例：10
- 通过：10
- 失败：0

| 用例 | 目标 | 实际结果 | 结论 |
|---|---|---|---|
| TC01 | 无历史数据默认 multiplier=1 | 1 | 通过 |
| TC02 | 平均值计算 | 1.5 | 通过 |
| TC03 | 下限钳制 | 0.7 | 通过 |
| TC04 | 上限钳制 | 2.5 | 通过 |
| TC05 | AI 子任务估时修正 | `[3, 6]`（原始 `[2, 4]`，倍率 1.5） | 通过 |
| TC06 | 无 subtasks 自动排期修正 | 总分配 6（原始 4，倍率 1.5） | 通过 |
| TC07 | 有 subtasks 自动排期不修正 | 总分配 2（保持原始值） | 通过 |
| TC08-drag | 拖拽迁移不重复放大 | `hasToday=false, tomorrowHours=2` | 通过 |
| TC08-remove | 移除后不残留放大工时 | `hasTomorrow=false` | 通过 |
| TC09 | Tab 快捷输入非回归 | 空输入按 Tab 自动填充；非空输入不覆盖 | 通过 |

## 4. 关键截图记录
- TC01 默认 multiplier：
  - `artifacts/estimate-multiplier/tc01-default-multiplier.png`
- TC05 AI 返回 subtasks 后修正：
  - `artifacts/estimate-multiplier/tc05-ai-adjusted-subtasks.png`
- TC06 无 subtasks 自动排期修正：
  - `artifacts/estimate-multiplier/tc06-autoassign-whole-task.png`
- TC07 有 subtasks 自动排期不修正：
  - `artifacts/estimate-multiplier/tc07-autoassign-subtasks.png`
- TC08 拖拽与移除回归：
  - `artifacts/estimate-multiplier/tc08-drag-after-move.png`
  - `artifacts/estimate-multiplier/tc08-remove-after-click.png`
- TC09 Tab 快捷输入：
  - `artifacts/estimate-multiplier/tc09-tab-quick-fill.png`

## 5. 复现命令
```powershell
# 1) 启动前端静态服务（项目根目录）
python -m http.server 4173 --directory frontend

# 2) 设置 Playwright 模块路径并运行验收脚本
$env:NODE_PATH = Join-Path $env:TEMP 'tt-acceptance\node_modules'
node scripts/run_estimate_acceptance.js
```
