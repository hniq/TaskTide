/* ================================================================
   不咕了 - NoProcrastination  |  Main JavaScript
   v2.1 - 修复版：删除重复模块/修复按钮/优化自动分配/AI预览确认
   ================================================================ */
/* 2026.03.05 17:13
新增功能:
easy task1: 统计耗时
*/


import { 
  uid, fmtDate, esc, dlText, calcQuadrant, calcPriority, 
  getQClass, totalHours, getWeekStart, WEEKDAYS, Q_LABELS, Q_SHORT 
} from './utils.js';
import { loadTasks, saveTasks, loadSettings, saveSettings } from './storage.js';
import { parseTaskWithAI, checkAIHealth } from './api.js';

// ======== State ========
let tasks = [];
let settings = {};
let currentView = 'month';
let viewDate = new Date();
let selectedTaskId = null;
let splitTargetId = null;
let activeFilter = null;
let confirmCb = null;
let confirmCb2 = null;  // 第二个操作回调
let sortMode = 'deadline'; // 'deadline' | 'priority' | 'manual'

// ======== Task Title Examples ========
const titleExamples = [
  '完成课程论文',
  '准备下周 presentation',
  '整理项目文档',
  '学习 React Hooks',
  '完成健身计划',
  '阅读技术书籍 30 分钟',
  '复习考试重点',
  '整理桌面文件',
  '写周报',
  '预约牙医检查',
  '购买生活用品',
  '规划周末行程'
];
let currentExampleIndex = 0;

// ======== Drag State ========
let draggedTaskId = null;
let draggedSubtaskId = null;
let sidebarDragId = null;       // 侧边栏任务拖动排序
let detailSubDragId = null;     // 详情页子任务拖动排序

// ======== Init ========
/** 初始化应用：加载数据、迁移、绑定事件、首次渲染 */
function init() {
  settings = loadSettings();
  tasks = loadTasks();
  migrateTasks();
  sortMode = settings.defaultSortMode || 'deadline';
  currentView = settings.defaultCalendarView || 'month';
  viewDate = new Date();
  renderAll();
  setupListeners();
}

/** 数据迁移：为旧数据补全新增字段 */
function migrateTasks() {
  let changed = false;
  tasks.forEach(t => {
    if (t.urgency === undefined) { t.urgency = 3; changed = true; }
    if (!t.eisenhowerQuadrant) { t.eisenhowerQuadrant = calcQuadrant(t); changed = true; }
    if (t.createdBy === undefined) { t.createdBy = 'manual'; changed = true; }
    if (!t.subtasks) t.subtasks = [];
    t.subtasks.forEach((s, i) => {
      if (s.order === undefined) { s.order = i; changed = true; }
      if (s.actualMin === undefined)  { s.actualMin = null; changed = true; }
      if (s.actualHours === undefined){ s.actualHours = null; changed = true; }
      if (s.miniStart === undefined)  { s.miniStart = ""; changed = true; }
    });
    if (!t.assignedDays) t.assignedDays = {};
    if (t.manualOrder === undefined) { t.manualOrder = 0; changed = true; }
  });
  if (changed) saveTasks(tasks);
}

// ======== Render All ========
function renderAll() {
  renderSidebar();
  renderMainView();
  renderPanel();
  updateNavTitle();
}

// ======== Sidebar ========
/** 渲染侧边栏：包含排序、筛选、任务列表、已完成区域和统计 */
function renderSidebar() {
  const list = document.getElementById('taskList');
  let active = tasks.filter(t => t.status === 'active');
  if (activeFilter) active = active.filter(t => t.eisenhowerQuadrant === activeFilter);

  // 排序逻辑
  active = sortTaskList(active);

  // 同步排序下拉
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) sortSelect.value = sortMode;

  if (!active.length) {
    list.innerHTML = '<div class="sidebar-empty">还没有任务<br>点击上方按钮或用 AI 输入框创建</div>';
  } else {
    let html = active.map((t, idx) => {
      const dl = dlText(t.deadline);
      const done = t.subtasks.filter(s => s.completed).length;
      const tot = t.subtasks.length;
      const pct = tot ? Math.round(done / tot * 100) : 0;
      
      return `<div class="tcard${selectedTaskId === t.id ? ' selected' : ''}" data-id="${t.id}" data-idx="${idx}" draggable="${sortMode === 'manual' ? 'true' : 'false'}">
        ${sortMode === 'manual' ? '<span class="tcard-drag" title="拖动排序">&#8942;&#8942;</span>' : ''}
        <div class="tcard-top"><span class="tcard-q ${getQClass(t.eisenhowerQuadrant)}"></span><span class="tcard-title">${esc(t.title)}</span></div>
        <div class="tcard-meta"><span class="tcard-dl ${dl.cls}">${dl.text}</span>${tot ? `<span class="tcard-progress"><span class="progress-bar"><span class="progress-fill" style="width:${pct}%"></span></span>${done}/${tot}</span>` : ''}</div>
      </div>`;
    }).join('');
    list.innerHTML = html;
    
    // 点击和拖动处理
    list.querySelectorAll('.tcard').forEach(card => {
      card.addEventListener('click', () => selectTask(card.dataset.id));
      if (sortMode === 'manual') {
        card.addEventListener('dragstart', e => handleSidebarDragStart(e, card.dataset.id));
        card.addEventListener('dragover', e => handleSidebarDragOver(e, card));
        card.addEventListener('dragleave', e => handleSidebarDragLeave(card));
        card.addEventListener('drop', e => handleSidebarDrop(e, card.dataset.id));
        card.addEventListener('dragend', () => handleSidebarDragEnd());
      }
    });
  }

  // 侧边栏已完成任务区域
  renderSidebarCompleted();

  // 统计
  const allActive = tasks.filter(t => t.status === 'active');
  const completed = tasks.filter(t => t.status === 'completed');
  const todayStr = fmtDate(new Date());
  let todayCount = 0;
  allActive.forEach(t => { 
    if (t.assignedDays && t.assignedDays[todayStr]) todayCount++; 
  });
  document.getElementById('sidebarStats').innerHTML = 
    `<span>共 ${allActive.length} 个任务</span><span>今日 ${todayCount} 项</span><span>已完成 ${completed.length}</span>`;

  // 筛选按钮状态
  const filterBtn = document.getElementById('filterBtn');
  filterBtn.classList.toggle('active', !!activeFilter);
  filterBtn.querySelector('span').textContent = activeFilter ? Q_SHORT[activeFilter] : '筛选';
}

/** 对任务列表按当前排序模式排序 */
function sortTaskList(list) {
  const sorted = [...list];
  switch (sortMode) {
    case 'deadline':
      sorted.sort((a, b) => {
        // 无截止日期排最后
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline.localeCompare(b.deadline);
      });
      break;
    case 'priority':
      sorted.sort((a, b) => calcPriority(b) - calcPriority(a));
      break;
    case 'manual':
      sorted.sort((a, b) => (a.manualOrder || 0) - (b.manualOrder || 0));
      break;
  }
  return sorted;
}

/** 渲染侧边栏已完成任务折叠区域 */
function renderSidebarCompleted() {
  const completed = tasks.filter(t => t.status === 'completed');
  document.getElementById('sidebarCompCount').textContent = completed.length;
  const list = document.getElementById('sidebarCompList');
  if (!completed.length) {
    list.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--text-4)">暂无已完成任务</div>';
    return;
  }
  // 渲染已完成任务列表，包含恢复和删除按钮
  list.innerHTML = completed.slice(0, 20).map(t => `
    <div class="sidebar-comp-item" data-id="${t.id}">
      <span class="comp-q ${getQClass(t.eisenhowerQuadrant)}" style="background:var(--${(t.eisenhowerQuadrant||'q4').toLowerCase()})"></span>
      <span class="comp-name">${esc(t.title)}</span>
      <div class="comp-actions">
        <button class="comp-restore-btn" data-id="${t.id}" title="恢复任务">&#8634;</button>
        <button class="comp-del-btn" data-id="${t.id}" title="删除任务">&#10005;</button>
      </div>
    </div>
  `).join('');
  
  // 绑定恢复按钮事件
  list.querySelectorAll('.comp-restore-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      restoreTask(btn.dataset.id);
    });
  });
  
  // 绑定删除按钮事件
  list.querySelectorAll('.comp-del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      showConfirm('删除任务', '确定永久删除此任务？', () => {
        tasks = tasks.filter(x => x.id !== id);
        saveTasks(tasks);
        renderAll();
        toast('已删除');
      });
    });
  });
}

// ======== Sidebar Drag Reorder ========
/** 侧边栏任务拖动开始 */
function handleSidebarDragStart(e, taskId) {
  sidebarDragId = taskId;
  e.dataTransfer.effectAllowed = 'move';
  e.target.classList.add('dragging');
}

/** 侧边栏任务拖动经过 */
function handleSidebarDragOver(e, card) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (!sidebarDragId || sidebarDragId === card.dataset.id) return;
  const rect = card.getBoundingClientRect();
  const mid = rect.top + rect.height / 2;
  card.classList.remove('drop-before', 'drop-after');
  card.classList.add(e.clientY < mid ? 'drop-before' : 'drop-after');
}

/** 侧边栏任务拖动离开 */
function handleSidebarDragLeave(card) {
  card.classList.remove('drop-before', 'drop-after');
}

/** 侧边栏任务拖放完成 */
function handleSidebarDrop(e, targetId) {
  e.preventDefault();
  if (!sidebarDragId || sidebarDragId === targetId) return;
  
  const card = e.currentTarget;
  const rect = card.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  
  // 获取当前排序后的 active 列表
  let active = tasks.filter(t => t.status === 'active');
  if (activeFilter) active = active.filter(t => t.eisenhowerQuadrant === activeFilter);
  active = sortTaskList(active);
  
  const fromIdx = active.findIndex(t => t.id === sidebarDragId);
  let toIdx = active.findIndex(t => t.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  
  if (!before) toIdx++;
  if (fromIdx < toIdx) toIdx--;
  
  const [moved] = active.splice(fromIdx, 1);
  active.splice(toIdx, 0, moved);
  
  // 更新 manualOrder
  active.forEach((t, i) => { t.manualOrder = i; });
  saveTasks(tasks);
  renderSidebar();
  toast('排序已更新');
}

/** 侧边栏拖动结束清理 */
function handleSidebarDragEnd() {
  sidebarDragId = null;
  document.querySelectorAll('.tcard').forEach(c => c.classList.remove('dragging', 'drop-before', 'drop-after'));
}

// ======== Main View ========
function setView(v) {
  currentView = v;
  document.querySelectorAll('.vtog-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  renderMainView();
  updateNavTitle();
}

function navPrev() {
  if (currentView === 'month') { viewDate.setMonth(viewDate.getMonth() - 1); }
  else if (currentView === 'week') { viewDate.setDate(viewDate.getDate() - 7); }
  renderMainView(); updateNavTitle();
}

function navNext() {
  if (currentView === 'month') { viewDate.setMonth(viewDate.getMonth() + 1); }
  else if (currentView === 'week') { viewDate.setDate(viewDate.getDate() + 7); }
  renderMainView(); updateNavTitle();
}

function navToday() { viewDate = new Date(); renderMainView(); updateNavTitle(); }

function updateNavTitle() {
  const el = document.getElementById('navTitle');
  if (currentView === 'month') { el.textContent = viewDate.getFullYear() + '年' + (viewDate.getMonth() + 1) + '月'; }
  else if (currentView === 'week') {
    const start = getWeekStart(viewDate);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    el.textContent = (start.getMonth() + 1) + '/' + start.getDate() + ' - ' + (end.getMonth() + 1) + '/' + end.getDate();
  }
  else if (currentView === 'today') {
    const today = new Date();
    el.textContent = today.getFullYear() + '年' + (today.getMonth() + 1) + '月' + today.getDate() + '日 · 今日专注';
  }
}

function renderMainView() {
  if (currentView === 'month') renderMonth();
  else if (currentView === 'week') renderWeek();
  else if (currentView === 'today') renderToday();
}

/** 构建日期→任务映射表（兼容新旧数据格式） */
function buildDayMap(activeTasks) {
  const dayMap = {};
  activeTasks.forEach(t => {
    if (!t.assignedDays) return;
    Object.keys(t.assignedDays).forEach(ds => {
      if (!dayMap[ds]) dayMap[ds] = [];
      const dayData = t.assignedDays[ds];
      if (typeof dayData === 'number') {
        dayMap[ds].push({ task: t, sub: { id: '__whole_' + t.id, title: t.title, estimatedHours: dayData } });
      } else if (dayData && dayData.subtaskIds) {
        dayData.subtaskIds.forEach(sid => {
          let sub;
          if (sid.startsWith('__whole_')) { sub = { id: sid, title: t.title, estimatedHours: t.estimatedHours || 0 }; }
          else { sub = t.subtasks.find(s => s.id === sid); }
          if (sub) dayMap[ds].push({ task: t, sub });
        });
      }
    });
  });
  return dayMap;
}

/** 渲染月视图 */
function renderMonth() {
  const body = document.getElementById('mainBody');
  const year = viewDate.getFullYear(), month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  let startOffset = firstDay.getDay() - 1; if (startOffset < 0) startOffset = 6;
  const today = fmtDate(new Date());
  const active = tasks.filter(t => t.status === 'active');
  const dayMap = buildDayMap(active);

  let html = '<div class="cal-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div class="cal-grid">';

  const prevMonth = new Date(year, month, 0);
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = prevMonth.getDate() - i;
    html += `<div class="cal-cell other-month"><div class="cal-date"><span class="cal-date-num">${d}</span></div></div>`;
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const ds = fmtDate(new Date(year, month, d));
    const isToday = ds === today;
    const list = dayMap[ds] || [];
    const hrs = list.reduce((s, x) => s + (x.sub.estimatedHours || 0), 0);
    const over = hrs > settings.dailyWorkHours;
    
    html += `<div class="cal-cell${isToday ? ' today' : ''}${over ? ' overloaded' : ''}" data-date="${ds}">
      <div class="cal-date"><span class="cal-date-num${isToday ? ' is-today' : ''}">${d}</span><span class="cal-hours${over ? ' over' : ''}">${hrs > 0 ? hrs + 'h' : ''}</span></div>
      <div class="cal-tasks-mini">${list.slice(0, 3).map(x => {
        const isCompleted = x.sub.completed ? ' completed' : '';
        return `<div class="cal-task-mini${isCompleted}" draggable="true" data-tid="${x.task.id}" data-sid="${x.sub.id}" onclick="showSubtaskDetail('${x.task.id}', '${x.sub.id}')">
          <span class="cal-task-title">${esc(x.sub.title)}</span>
        </div>`;
      }).join('')}${list.length > 3 ? `<div class="cal-task-mini" style="color:var(--text-4)">+${list.length - 3} more</div>` : ''}</div>
    </div>`;
  }

  const totalCells = startOffset + lastDay.getDate();
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= trailing; d++) {
    html += `<div class="cal-cell other-month"><div class="cal-date"><span class="cal-date-num">${d}</span></div></div>`;
  }

  html += '</div>';
  body.innerHTML = html;
  
  // 绑定日历拖拽事件
  bindCalendarDragEvents();
}

/** 渲染周视图 */
function renderWeek() {
  const body = document.getElementById('mainBody');
  const start = getWeekStart(viewDate);
  const active = tasks.filter(t => t.status === 'active');
  const today = fmtDate(new Date());
  const dayMap = buildDayMap(active);

  let html = '<div class="week-grid">';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = fmtDate(d);
    const isToday = ds === today;
    let list = dayMap[ds] || [];
    
    // 按四象限优先级排序：Q1 > Q2 > Q3 > Q4
    const qOrder = { 'Q1': 0, 'Q2': 1, 'Q3': 2, 'Q4': 3 };
    list = [...list].sort((a, b) => {
      const qa = qOrder[a.task.eisenhowerQuadrant] ?? 3;
      const qb = qOrder[b.task.eisenhowerQuadrant] ?? 3;
      return qa - qb;
    });
    
    const hrs = list.reduce((s, x) => s + (x.sub.estimatedHours || 0), 0);
    const over = hrs > settings.dailyWorkHours;

    html += `<div class="week-col" data-date="${ds}">
      <div class="week-col-header">
        <div class="wdate${isToday ? ' is-today' : ''}">${d.getDate()}</div>
        <div class="wday">${WEEKDAYS[d.getDay()]}</div>
        <div class="whours${over ? ' over' : ''}">${hrs}h / ${settings.dailyWorkHours}h</div>
      </div>
      <div class="week-col-body" data-date="${ds}">
        ${list.length ? list.map(x => {
          const isCompleted = x.sub.completed ? ' completed' : '';
          return `<div class="week-task ${getQClass(x.task.eisenhowerQuadrant)}${isCompleted}" draggable="true" data-sid="${x.sub.id}" data-tid="${x.task.id}" onclick="showSubtaskDetail('${x.task.id}', '${x.sub.id}')">
          <div class="week-task-title">${esc(x.sub.title)}</div>
          <div class="week-task-parent">${esc(x.task.title)}</div>
          <div class="week-task-hours">${formatDuration(x.sub.estimatedHours)} <span class="week-task-rm" data-sid="${x.sub.id}" data-tid="${x.task.id}" data-date="${ds}" onclick="event.stopPropagation();removeFromCalendar('${x.task.id}', '${x.sub.id}', '${ds}')">&#10005;</span></div>
        </div>`;
        }).join('') : '<div class="week-empty">无任务</div>'}
      </div>
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
  
  // 绑定日历拖拽事件
  bindCalendarDragEvents();
  
  // 绑定周视图内部拖动排序
  bindWeekTaskDrag();
}

/** 渲染今日专注视图 */
function renderToday() {
  const body = document.getElementById('mainBody');
  const todayStr = fmtDate(new Date());
  const active = tasks.filter(t => t.status === 'active');
  
  // 收集今日所有子任务
  let todaySubs = [];
  active.forEach(t => {
    if (!t.subtasks) return;
    t.subtasks.forEach((sub, idx) => {
      if (sub.completed) return;
      // 检查是否已分配到今日
      const isAssignedToday = t.assignedDays && t.assignedDays[todayStr];
      todaySubs.push({
        task: t,
        sub: sub,
        priority: calcPriority(t),
        isAssigned: !!isAssignedToday,
        order: idx
      });
    });
  });
  
  // 按优先级排序，取前三
  todaySubs.sort((a, b) => b.priority - a.priority);
  const top3 = todaySubs.slice(0, 3);
  
  // 为每个子任务生成最小可开始版本
  const miniStartActions = [
    { keyword: ['写', '论文', '报告', '文档'], action: '打开文档写3行大纲' },
    { keyword: ['读', '书', '文章', '资料'], action: '读第一页并标记3个重点' },
    { keyword: ['学', '课程', '教程'], action: '观看5分钟入门视频' },
    { keyword: ['整理', '清理', '收拾'], action: '花5分钟整理最显眼的一个区域' },
    { keyword: ['准备', '计划', '规划'], action: '列出3个必须完成的关键点' },
    { keyword: ['设计', '画图', '原型'], action: '在纸上画一个草图框架' },
    { keyword: ['代码', '开发', '编程'], action: '创建一个文件并写5行伪代码' },
    { keyword: ['测试', '调试', '修复'], action: '运行一次并记录第一个错误' },
    { keyword: ['会议', '讨论', '沟通'], action: '列出3个要讨论的核心问题' },
    { keyword: ['购买', '买', '采购'], action: '打开购物网站搜索第一个商品' }
  ];
  
  function generateMiniStart(subtaskTitle) {
    const title = subtaskTitle.toLowerCase();
    for (const rule of miniStartActions) {
      if (rule.keyword.some(k => title.includes(k))) {
        return rule.action;
      }
    }
    // 默认模板
    const defaults = [
      '花5分钟写下3个关键词',
      '打开相关应用/文档看一眼',
      '设置一个5分钟计时器开始',
      '写下完成这个任务的第一步',
      '收集一个相关的参考资料'
    ];
    return defaults[Math.floor(Math.random() * defaults.length)];
  }
  
  let html = '<div class="today-view">';
  
  // 顶部欢迎语
  const hour = new Date().getHours();
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  html += `<div class="today-greeting">${greeting}，今天专注这三件事</div>`;
  
  // 前三任务 + 每个子任务的最小可开始版本
  if (top3.length > 0) {
    html += '<div class="today-top3">';
    top3.forEach((item, i) => {
      const qClass = getQClass(item.task.eisenhowerQuadrant);
      const miniStart = generateMiniStart(item.sub.title);
      html += `
        <div class="today-task-card ${qClass}" data-tid="${item.task.id}" data-sid="${item.sub.id}">
          <div class="today-task-rank">${i + 1}</div>
          <div class="today-task-content">
            <div class="today-task-title">${esc(item.sub.title)}</div>
            <div class="today-task-parent">来自：${esc(item.task.title)}</div>
            <div class="today-task-ministart">
              <span class="ministart-label">🚀 最小开始：</span>
              <span class="ministart-action">${miniStart}</span>
            </div>
            <div class="today-task-meta">
              <span class="today-task-priority">优先级 ${item.priority.toFixed(1)}</span>
              <span class="today-task-hours">${formatDuration(item.sub.estimatedHours || 1)}</span>
              ${item.isAssigned ? '<span class="today-task-assigned">已排程</span>' : '<span class="today-task-unassigned">未排程</span>'}
            </div>
          </div>
          <div class="today-task-actions">
            <button class="today-btn-pomodoro" data-tid="${item.task.id}" data-sid="${item.sub.id}" title="开始番茄钟">🍅</button>
            <button class="today-btn-done" data-tid="${item.task.id}" data-sid="${item.sub.id}" title="完成">✓</button>
          </div>
        </div>
      `;
    });
    html += '</div>';
  } else {
    html += '<div class="today-empty">今天没有待办子任务，去创建新任务吧！</div>';
  }
  
  // 今日统计
  const completedToday = todaySubs.filter(x => x.sub.completed).length;
  html += `
    <div class="today-stats">
      <div class="today-stat">
        <span class="today-stat-num">${top3.length}</span>
        <span class="today-stat-label">待办子任务</span>
      </div>
      <div class="today-stat">
        <span class="today-stat-num">${todaySubs.filter(x => x.isAssigned).length}</span>
        <span class="today-stat-label">已排程</span>
      </div>
    </div>
  `;
  
  html += '</div>';
  body.innerHTML = html;
  
  // 绑定事件
  document.querySelectorAll('.today-task-card').forEach(card => {
    card.addEventListener('click', () => {
      const tid = card.dataset.tid;
      const sid = card.dataset.sid;
      showSubtaskDetail(tid, sid);
    });
  });
  
  document.querySelectorAll('.today-btn-pomodoro').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openPomodoroTimer(btn.dataset.tid, btn.dataset.sid);
    });
  });
  
  document.querySelectorAll('.today-btn-done').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      completeSubtask(btn.dataset.tid, btn.dataset.sid);
    });
  });
}

/** 为日历视图绑定拖拽事件（月视图格子、周视图列） */
function bindCalendarDragEvents() {
  // 拖拽源：日历中的任务项
  document.querySelectorAll('.cal-task-mini[draggable], .week-task[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => {
      draggedTaskId = el.dataset.tid;
      draggedSubtaskId = el.dataset.sid;
      e.dataTransfer.effectAllowed = 'move';
      el.style.opacity = '0.5';
    });
    el.addEventListener('dragend', () => { el.style.opacity = ''; });
  });
  
  // 拖拽目标：日历格子/列
  const targets = document.querySelectorAll('.cal-cell[data-date], .week-col[data-date]');
  targets.forEach(cell => {
    cell.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cell.classList.add('drag-over');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', e => {
      e.preventDefault();
      cell.classList.remove('drag-over');
      const targetDate = cell.dataset.date;
      handleCalendarDrop(targetDate);
    });
  });
  
  // 周视图移除按钮
  document.querySelectorAll('.week-task-rm').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      removeFromCalendar(btn.dataset.tid, btn.dataset.sid, btn.dataset.date);
    });
  });
}

/** 绑定周视图内部任务拖动排序 */
function bindWeekTaskDrag() {
  const cols = document.querySelectorAll('.week-col-body');
  cols.forEach(col => {
    const date = col.dataset.date;
    const taskEls = col.querySelectorAll('.week-task');
    
    taskEls.forEach(taskEl => {
      taskEl.addEventListener('dragover', e => {
        e.preventDefault();
        if (!draggedTaskId || !draggedSubtaskId) return;
        
        // 只在同一列内排序
        const parent = taskEl.closest('.week-col-body');
        if (parent.dataset.date !== date) return;
        
        const rect = taskEl.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        taskEl.classList.remove('drop-before', 'drop-after');
        taskEl.classList.add(e.clientY < mid ? 'drop-before' : 'drop-after');
      });
      
      taskEl.addEventListener('dragleave', () => {
        taskEl.classList.remove('drop-before', 'drop-after');
      });
    });
  });
}

/** 处理日历拖拽放置：将任务/子任务移到目标日期 */
function handleCalendarDrop(targetDate) {
  if (!draggedTaskId || !draggedSubtaskId) return;
  
  const task = tasks.find(t => t.id === draggedTaskId);
  if (!task) return;
  
  // 找到子任务信息
  let subtask;
  if (draggedSubtaskId.startsWith('__whole_')) {
    subtask = { id: draggedSubtaskId, title: task.title, estimatedHours: task.estimatedHours || 1 };
  } else {
    subtask = task.subtasks.find(s => s.id === draggedSubtaskId);
  }
  if (!subtask) return;
  
  // 从原日期中移除
  if (task.assignedDays) {
    Object.keys(task.assignedDays).forEach(ds => {
      const dayData = task.assignedDays[ds];
      if (typeof dayData === 'number' && draggedSubtaskId.startsWith('__whole_')) {
        // 整个任务格式，移除
        delete task.assignedDays[ds];
      } else if (typeof dayData === 'object' && dayData.subtaskIds) {
        const idx = dayData.subtaskIds.indexOf(draggedSubtaskId);
        if (idx > -1) {
          dayData.subtaskIds.splice(idx, 1);
          dayData.hours -= subtask.estimatedHours;
          if (dayData.hours <= 0 || dayData.subtaskIds.length === 0) {
            delete task.assignedDays[ds];
          }
        }
      }
    });
  }
  
  // 添加到新日期
  if (!task.assignedDays) task.assignedDays = {};
  if (!task.assignedDays[targetDate]) {
    task.assignedDays[targetDate] = { subtaskIds: [], hours: 0 };
  }
  let targetDay = task.assignedDays[targetDate];
  
  // 统一转为对象格式以支持子任务级别追踪
  if (typeof targetDay === 'number') {
    task.assignedDays[targetDate] = { subtaskIds: ['__whole_' + task.id], hours: targetDay };
    targetDay = task.assignedDays[targetDate];
  }
  
  if (!targetDay.subtaskIds.includes(draggedSubtaskId)) {
    targetDay.subtaskIds.push(draggedSubtaskId);
    targetDay.hours += subtask.estimatedHours;
  }
  
  // 标记子任务为手动分配
  if (subtask.id && !subtask.id.startsWith('__whole_')) {
    subtask._manuallyAssigned = true;
    subtask._assignedDate = targetDate;
  }
  
  // 如果是主任务拖到日期，更新 deadline
  if (draggedSubtaskId.startsWith('__whole_')) {
    task.deadline = targetDate;
  }
  
  saveTasks(tasks);
  renderAll();
  toast('已移到 ' + targetDate);
  
  draggedTaskId = null;
  draggedSubtaskId = null;
}

/** 从日历中移除某个任务/子任务的分配 */
function removeFromCalendar(tid, sid, date) {
  const task = tasks.find(t => t.id === tid);
  if (!task || !task.assignedDays || !task.assignedDays[date]) return;
  
  const dayData = task.assignedDays[date];
  if (typeof dayData === 'number') {
    delete task.assignedDays[date];
  } else if (dayData.subtaskIds) {
    const idx = dayData.subtaskIds.indexOf(sid);
    if (idx > -1) {
      const sub = task.subtasks.find(s => s.id === sid);
      dayData.subtaskIds.splice(idx, 1);
      if (sub) dayData.hours -= sub.estimatedHours;
      if (dayData.subtaskIds.length === 0 || dayData.hours <= 0) {
        delete task.assignedDays[date];
      }
    }
  }
  
  saveTasks(tasks);
  renderAll();
  toast('已移除');
}

// ======== Right Panel ========
/** 渲染右侧面板：四象限矩阵和本周统计 */
function renderPanel() {
  const active = tasks.filter(t => t.status === 'active');
  const completed = tasks.filter(t => t.status === 'completed');
  const qCounts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  active.forEach(t => { if (t.eisenhowerQuadrant) qCounts[t.eisenhowerQuadrant]++; });

  document.getElementById('matrixGrid').innerHTML = ['Q1', 'Q2', 'Q3', 'Q4'].map(q => 
    `<div class="matrix-cell ${q.toLowerCase()}${activeFilter === q ? ' active' : ''}" data-q="${q}">
      <span class="mc-q">${q}</span><span class="mc-n">${qCounts[q]}</span><span class="mc-l">${Q_LABELS[q]}</span>
    </div>`
  ).join('');

  // 本周统计（含已完成数量）
  const start = getWeekStart(new Date());
  let weekHours = 0, weekTasks = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = fmtDate(d);
    active.forEach(t => {
      if (t.assignedDays && t.assignedDays[ds]) {
        weekTasks++;
        weekHours += typeof t.assignedDays[ds] === 'number' ? t.assignedDays[ds] : (t.assignedDays[ds].hours || 0);
      }
    });
  }
  
  // 本周完成的任务数
  const weekStart = getWeekStart(new Date());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
  const weekCompleted = completed.filter(t => {
    if (!t.completedAt) return false;
    const d = new Date(t.completedAt);
    return d >= weekStart && d < weekEnd;
  }).length;
  
  document.getElementById('weekStats').innerHTML = `
    <div class="stat-row"><span class="stat-label">本周任务</span><span class="stat-val">${weekTasks}</span></div>
    <div class="stat-row"><span class="stat-label">预计工时</span><span class="stat-val">${weekHours}h</span></div>
    <div class="stat-row"><span class="stat-label">每日平均</span><span class="stat-val">${(weekHours / 7).toFixed(1)}h</span></div>
    <div class="stat-row"><span class="stat-label">本周已完成</span><span class="stat-val" style="color:var(--success)">${weekCompleted}</span></div>
  `;
}

// ======== Sidebar Completed Toggle ========
function toggleSidebarCompleted() {
  const list = document.getElementById('sidebarCompList');
  const arrow = document.getElementById('sidebarCompArrow');
  list.classList.toggle('open');
  arrow.classList.toggle('open');
}

// ======== Chunk (切块) & Format Utilities ========

/** 将小时数舍入到 0.25 粒度，最小 0.25 */
function roundToQuarter(hours) {
  const v = Math.round(hours / 0.25) * 0.25;
  return Math.max(0.25, v);
}

/** 格式化时长显示：>=1h 显示 Xh，<1h 显示 XX分钟 */
function formatDuration(hours) {
  const h = Number(hours);
  if (isNaN(h) || h <= 0) return '';
  if (h >= 1) {
    return Number.isInteger(h) ? `${h}h` : `${parseFloat(h.toFixed(1))}h`;
  }
  return `${Math.round(h * 60)}分钟`;
}

/** 去掉标题中已有的 session 后缀，如 " (2/3)" 或 " 2/3" */
function stripSessionSuffix(title) {
  return title.replace(/\s*\(?\d+\/\d+\)?\s*$/, '').trim();
}

/** 根据标题关键词生成 miniStart 提示（纯规则，不调 AI） */
function genMiniStart(title) {
  if (/代码|开发|实现|修复|bug|编程|编码/i.test(title)) {
    return '打开项目跑起来，定位到相关文件，先改一个最小点';
  }
  if (/阅读|文献|学习|读/.test(title)) {
    return '打开材料，先扫读目录并写3个问题';
  }
  if (/写|撰写|文档|报告|总结/.test(title)) {
    return '打开文档，先写5行大纲或列5个要点';
  }
  return '打开相关材料，写下3条要点，然后开始计时';
}

/**
 * 对"当前这一条 subtask"做一次切块，返回 minutes 数组。
 * 递归友好：根据当前 totalMin 决定如何拆分。
 */
function splitOnce(totalMin) {
  // 太小不切
  if (totalMin < 20) return null;

  // >= 90：拆出一个 90，remainder 按 45/25 继续
  if (totalMin >= 90) {
    if (totalMin === 90) {
      // 对 90min 再切 → [45, 45]
      return [45, 45];
    }
    const chunks = [90];
    let rem = totalMin - 90;
    while (rem >= 45) { chunks.push(45); rem -= 45; }
    while (rem >= 25) { chunks.push(25); rem -= 25; }
    if (rem > 0) {
      if (rem < 10 && chunks.length > 0) {
        chunks[chunks.length - 1] += rem;
      } else {
        chunks.push(rem);
      }
    }
    return chunks.length > 1 ? chunks : null;
  }

  // 45-89min 区间
  if (totalMin >= 45) {
    if (totalMin === 45) {
      // 对 45min 再切 → [25, 20]
      return [25, 20];
    }
    const chunks = [45];
    let rem = totalMin - 45;
    while (rem >= 25) { chunks.push(25); rem -= 25; }
    if (rem > 0) {
      if (rem < 10 && chunks.length > 0) {
        chunks[chunks.length - 1] += rem;
      } else {
        chunks.push(rem);
      }
    }
    return chunks.length > 1 ? chunks : null;
  }

  // 25-44min 区间
  if (totalMin >= 25) {
    if (totalMin === 25) {
      // 对 25min 再切 → [15, 10]
      return [15, 10];
    }
    const first = Math.min(25, totalMin);
    const rem = totalMin - first;
    if (rem >= 10) {
      return [first, rem];
    }
    if (rem > 0 && rem < 10) {
      return [first + rem]; // 合并，等于没拆
    }
    return null;
  }

  // 20-24min
  if (totalMin >= 20) {
    return [10, totalMin - 10];
  }

  return null;
}

/** 替换 assignedDays 中旧子任务 id 为新子任务 ids */
function replaceAssignmentIds(task, oldSid, oldHours, newSubs) {
  if (!task.assignedDays) return;
  const newSids = newSubs.map(s => s.id);
  const newTotalHours = newSubs.reduce((s, x) => s + x.estimatedHours, 0);

  Object.keys(task.assignedDays).forEach(date => {
    let dayData = task.assignedDays[date];

    // 兼容 number 旧格式
    if (typeof dayData === 'number') {
      task.assignedDays[date] = { subtaskIds: ['__whole_' + task.id], hours: dayData };
      dayData = task.assignedDays[date];
    }

    if (!dayData.subtaskIds) return;
    const idx = dayData.subtaskIds.indexOf(oldSid);
    if (idx === -1) return;

    dayData.subtaskIds.splice(idx, 1, ...newSids);
    dayData.hours = Math.max(0, (dayData.hours || 0) - oldHours + newTotalHours);

    if (dayData.subtaskIds.length === 0 || dayData.hours <= 0) {
      delete task.assignedDays[date];
    }
  });
}

/** 将指定子任务切块为多个 session（递归友好：每次只切一层） */
function chunkSubtaskIntoSessions(taskId, subId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  const subIdx = task.subtasks.findIndex(s => s.id === subId);
  if (subIdx === -1) return;
  const oldSub = task.subtasks[subIdx];
  const oldHours = oldSub.estimatedHours || 0;

  const totalMin = Math.round(oldHours * 60);
  if (totalMin < 20) {
    toast('已是最小块，无法继续切分');
    return;
  }

  const chunks = splitOnce(totalMin);
  if (!chunks || chunks.length <= 1) {
    toast('已是最小块，无法继续切分');
    return;
  }

  const n = chunks.length;
  const baseTitle = stripSessionSuffix(oldSub.title);
  const miniStart = genMiniStart(baseTitle);

  const newSubs = chunks.map((chunkMin, i) => ({
    id: uid(),
    title: `${baseTitle} (${i + 1}/${n})`,
    estimatedHours: parseFloat((chunkMin / 60).toFixed(4)),
    completed: false,
    order: 0,
    miniStart: miniStart,
    actualMin: null,
    actualHours: null,
    ...(oldSub._manuallyAssigned ? { _manuallyAssigned: true } : {}),
    ...(oldSub._assignedDate ? { _assignedDate: oldSub._assignedDate } : {})
  }));

  replaceAssignmentIds(task, subId, oldHours, newSubs);
  task.subtasks.splice(subIdx, 1, ...newSubs);
  task.subtasks.forEach((s, i) => { s.order = i; });
  task.estimatedHours = task.subtasks.reduce((s, x) => s + (x.estimatedHours || 0), 0);

  saveTasks(tasks);
  renderAll();
  if (selectedTaskId === taskId) showTaskDetail(taskId);
  toast(`已切块为 ${n} 个 session`);
}

// ======== Task Selection & Detail (Inline Editing) ========
function selectTask(id) {
  selectedTaskId = id;
  renderSidebar();
  showTaskDetail(id);
}

/** 显示任务详情面板（内联编辑模式 + 集成拆分 + 单任务自动分配） */
function showTaskDetail(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  
  // 标题：内联编辑
  const titleInput = document.getElementById('detailTitleInput');
  titleInput.value = t.title;
  titleInput.onchange = () => {
    const newTitle = titleInput.value.trim();
    if (newTitle && newTitle !== t.title) {
      t.title = newTitle;
      saveTasks(tasks);
      renderSidebar();
      renderMainView();
      toast('标题已更新');
    }
  };
  
  const dl = dlText(t.deadline);
  const done = t.subtasks.filter(s => s.completed).length;
  const tot = t.subtasks.length;
  
  document.getElementById('detailBody').innerHTML = `
    <div class="detail-meta">
      <span class="detail-badge ${getQClass(t.eisenhowerQuadrant)}">${Q_LABELS[t.eisenhowerQuadrant]}</span>
      <span class="detail-badge dl${dl.cls ? ' ' + dl.cls : ''}">${dl.text}</span>
      <span class="detail-badge hours">${totalHours(t)}h</span>
    </div>
    
    <div class="detail-section">
      <h4>基本信息</h4>
      <div class="detail-inline-row">
        <label>截止日期</label>
        <input type="date" class="detail-inline-input" id="detailDeadline" value="${t.deadline || ''}">
      </div>
      <div class="detail-slider-row" style="margin-bottom:8px">
        <label>重要程度</label>
        <input type="range" min="1" max="5" value="${t.importance || 3}" id="detailImportance" class="importance-range">
        <span class="detail-slider-val" id="detailImpVal">${t.importance || 3}</span>
      </div>
      <div class="detail-slider-row" style="margin-bottom:8px">
        <label>紧急程度</label>
        <input type="range" min="1" max="5" value="${t.urgency || 3}" id="detailUrgency" class="urgency-range">
        <span class="detail-slider-val" id="detailUrgVal">${t.urgency || 3}</span>
      </div>
      <div class="detail-inline-row">
        <label>备注</label>
        <textarea class="detail-notes-area" id="detailNotes" placeholder="可选备注...">${esc(t.notes || '')}</textarea>
      </div>
    </div>
    
    <div class="detail-actions-row">
      <button class="dbtn dbtn-primary" id="detailComplete">${t.status === 'completed' ? '恢复' : '完成'}</button>
      <button class="dbtn dbtn-accent" id="detailAutoAssign">自动分配</button>
      <button class="dbtn dbtn-danger" id="detailDelete">删除</button>
    </div>
    
    <div class="detail-section">
      <h4>子任务 (${done}/${tot})</h4>
      <ul class="sub-list" id="detailSubList">
        ${t.subtasks.map((s, i) => `<li class="sub-item${s.completed ? ' done' : ''}" data-sid="${s.id}" draggable="true">
          <span class="sub-handle">&#8942;&#8942;</span>
          <input type="checkbox" class="sub-check" data-tid="${t.id}" data-sid="${s.id}"${s.completed ? ' checked' : ''}>
          <div class="sub-content">
            <span class="sub-title">${esc(s.title)}</span>
            ${s.miniStart ? `<span class="sub-mini">${esc(s.miniStart)}</span>` : ''}
          </div>
          <span class="sub-hours">${formatDuration(s.estimatedHours)}</span>
          ${s.actualMin != null ? `<span class="sub-actual">实际${s.actualMin}m</span>` : ''}
          ${(s.estimatedHours >= 0.5 && !s.completed) ? `<button class="sub-chunk-btn" data-tid="${t.id}" data-sid="${s.id}">切块</button>` : ''}
          <span class="sub-rm" data-tid="${t.id}" data-sid="${s.id}">&#10005;</span>
        </li>`).join('')}
      </ul>
      <div class="sub-add-row">
        <input type="text" id="newSubTitle" placeholder="新子任务">
        <input type="number" id="newSubHours" placeholder="小时" min="0.5" step="0.5" value="1">
        <button class="sub-add-btn" id="addSubBtn">添加</button>
      </div>
    </div>
    
    <div class="detail-split-section">
      <div class="detail-split-header">
        <h4>智能拆分</h4>
        <button class="dbtn" style="font-size:11px;padding:3px 10px" id="detailAISplitBtn">AI 拆分</button>
      </div>
      <div class="fg" style="margin-bottom:8px"><label style="font-size:11px">总预估时长 (小时)</label><input type="number" id="detailSplitHours" min="0.5" step="0.5" value="${totalHours(t) || 8}" style="width:80px;padding:4px 8px;border:1px solid var(--border-0);border-radius:4px;font-size:12px;background:var(--bg-4);color:var(--text-1)"></div>
      <div id="detailSplitItems"></div>
      <div id="detailSplitTotal" style="font-size:11px;color:var(--text-3);text-align:right;margin-top:4px"></div>
      <button class="dbtn" style="margin-top:4px;font-size:11px" id="detailAddSplitItem">+ 添加子任务</button>
      <div class="split-confirm-bar" id="splitConfirmBar" style="display:none">
        <button class="dbtn" id="splitCancelBtn">取消</button>
        <button class="dbtn dbtn-primary" id="splitApplyBtn">确认拆分</button>
      </div>
    </div>
  `;
  
  // 打开面板
  document.getElementById('detailMask').classList.add('open');
  document.getElementById('detailPanel').classList.add('open');
  
  // ---- 绑定内联编辑事件 ----
  // 截止日期
  document.getElementById('detailDeadline').onchange = (e) => {
    t.deadline = e.target.value || null;
    t.eisenhowerQuadrant = calcQuadrant(t);
    saveTasks(tasks);
    renderSidebar();
    renderMainView();
    renderPanel();
    showTaskDetail(id); // 刷新详情
    toast('截止日期已更新');
  };
  
  // 重要/紧急程度
  const impSlider = document.getElementById('detailImportance');
  const urgSlider = document.getElementById('detailUrgency');
  impSlider.oninput = () => {
    document.getElementById('detailImpVal').textContent = impSlider.value;
  };
  urgSlider.oninput = () => {
    document.getElementById('detailUrgVal').textContent = urgSlider.value;
  };
  impSlider.onchange = () => {
    t.importance = parseInt(impSlider.value);
    t.eisenhowerQuadrant = calcQuadrant(t);
    saveTasks(tasks);
    renderSidebar();
    renderPanel();
    // 更新 badge
    const badge = document.querySelector('.detail-badge.' + getQClass(t.eisenhowerQuadrant));
    if (badge) badge.textContent = Q_LABELS[t.eisenhowerQuadrant];
    toast('重要程度已更新');
  };
  urgSlider.onchange = () => {
    t.urgency = parseInt(urgSlider.value);
    t.eisenhowerQuadrant = calcQuadrant(t);
    saveTasks(tasks);
    renderSidebar();
    renderPanel();
    toast('紧急程度已更新');
  };
  
  // 备注
  document.getElementById('detailNotes').onchange = (e) => {
    t.notes = e.target.value.trim();
    saveTasks(tasks);
  };
  
  // 完成/恢复按钮
  document.getElementById('detailComplete').onclick = () => {
    if (t.status === 'completed') {
      restoreTask(id);
    } else {
      completeTask(id);
    }
  };
  
  // 单任务自动分配按钮
  document.getElementById('detailAutoAssign').onclick = () => {
    autoAssignSingleTask(t);
    saveTasks(tasks);
    renderAll();
    showTaskDetail(id);
    toast('已为该任务执行自动分配');
  };
  
  // 删除按钮
  document.getElementById('detailDelete').onclick = () => { closeDetail(); deleteTask(id); };
  
  // 添加子任务
  document.getElementById('addSubBtn').onclick = () => addSubtask(id);
  
  // 子任务 checkbox
  document.querySelectorAll('.sub-check').forEach(cb => {
    cb.onchange = (e) => toggleSubtask(e.target.dataset.tid, e.target.dataset.sid, e.target.checked);
  });
  
  // 子任务删除
  document.querySelectorAll('.sub-rm').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); removeSubtask(btn.dataset.tid, btn.dataset.sid); };
  });
  
  // 子任务切块按钮
  document.querySelectorAll('.sub-chunk-btn').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); chunkSubtaskIntoSessions(btn.dataset.tid, btn.dataset.sid); };
  });
  
  // 子任务拖动排序
  setupSubtaskDrag(t);
  
  // ---- 拆分功能绑定 ----
  document.getElementById('detailAISplitBtn').onclick = () => doAISplit(id);
  document.getElementById('detailAddSplitItem').onclick = () => addDetailSplitItem();
  document.getElementById('splitCancelBtn').onclick = () => {
    document.getElementById('detailSplitItems').innerHTML = '';
    document.getElementById('detailSplitTotal').textContent = '';
    document.getElementById('splitConfirmBar').style.display = 'none';
  };
  document.getElementById('splitApplyBtn').onclick = () => applyDetailSplit(id);
  
  // 关闭
  document.getElementById('detailClose').onclick = closeDetail;
  document.getElementById('detailMask').onclick = closeDetail;
}

/** 子任务列表拖动排序设置 */
function setupSubtaskDrag(task) {
  const listEl = document.getElementById('detailSubList');
  if (!listEl) return;
  
  listEl.querySelectorAll('.sub-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      detailSubDragId = item.dataset.sid;
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (!detailSubDragId || detailSubDragId === item.dataset.sid) return;
      const rect = item.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      item.classList.remove('drop-before', 'drop-after');
      item.classList.add(e.clientY < mid ? 'drop-before' : 'drop-after');
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drop-before', 'drop-after');
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (!detailSubDragId) return;
      const targetSid = item.dataset.sid;
      if (detailSubDragId === targetSid) return;
      
      const rect = item.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      
      const fromIdx = task.subtasks.findIndex(s => s.id === detailSubDragId);
      let toIdx = task.subtasks.findIndex(s => s.id === targetSid);
      if (fromIdx === -1 || toIdx === -1) return;
      
      if (!before) toIdx++;
      if (fromIdx < toIdx) toIdx--;
      
      const [moved] = task.subtasks.splice(fromIdx, 1);
      task.subtasks.splice(toIdx, 0, moved);
      
      // 更新 order
      task.subtasks.forEach((s, i) => { s.order = i; });
      saveTasks(tasks);
      showTaskDetail(task.id);
    });
    item.addEventListener('dragend', () => {
      detailSubDragId = null;
      listEl.querySelectorAll('.sub-item').forEach(i => i.classList.remove('dragging', 'drop-before', 'drop-after'));
    });
  });
}

function closeDetail() {
  document.getElementById('detailMask').classList.remove('open');
  document.getElementById('detailPanel').classList.remove('open');
}

// ======== Detail Panel Split Functions ========
/** AI智能拆分（集成在详情页，先展示结果等待用户确认） */
async function doAISplit(id) {
  const t = tasks.find(x => x.id === id);
  const btn = document.getElementById('detailAISplitBtn');
  const originalText = btn.textContent;
  btn.textContent = 'AI拆分中...';
  btn.disabled = true;
  
  try {
    const result = await parseTaskWithAI(t.title);
    if (result && result.subtasks && result.subtasks.length > 0) {
      showSplitPreview(result.subtasks);
      toast('AI 拆分完成，请确认后应用', 'success');
    } else {
      showSplitPreview(getTemplateSplit(t));
      toast('AI 未返回结果，使用默认模板', 'info');
    }
  } catch (err) {
    console.error('AI 拆分失败:', err);
    showSplitPreview(getTemplateSplit(t));
    toast('AI 拆分失败，使用默认模板', 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

/** 获取模板拆分建议 */
function getTemplateSplit(t) {
  const total = parseFloat(document.getElementById('detailSplitHours')?.value) || totalHours(t) || 8;
  const templates = {
    '论文': ['文献综述', '撰写初稿', '修改完善', '格式排版'],
    '报告': ['资料收集', '大纲规划', '内容撰写', '审核修改'],
    '学习': ['预习概览', '深度学习', '练习巩固', '总结复习'],
    '项目': ['需求分析', '方案设计', '开发实现', '测试部署']
  };
  let titles = ['阶段一', '阶段二', '阶段三', '阶段四'];
  for (const [k, v] of Object.entries(templates)) {
    if (t.title.includes(k)) { titles = v; break; }
  }
  const per = Math.round(total / titles.length * 10) / 10;
  return titles.map(title => ({ title, estimatedHours: per }));
}

/** 在详情面板展示拆分预览（等待用户确认） */
function showSplitPreview(subtasks) {
  const container = document.getElementById('detailSplitItems');
  container.innerHTML = subtasks.map((sub, i) => `
    <div class="split-item">
      <input type="text" value="${esc(sub.title)}" class="split-title-input">
      <input type="number" value="${sub.estimatedHours || 2}" min="0.5" step="0.5" class="split-hours-input">
      <span class="split-rm" style="cursor:pointer;color:var(--text-4)">&#10005;</span>
    </div>
  `).join('');
  
  // 绑定删除
  container.querySelectorAll('.split-rm').forEach(rm => {
    rm.onclick = () => { rm.parentElement.remove(); updateDetailSplitTotal(); };
  });
  
  // 绑定小时数变化
  container.querySelectorAll('.split-hours-input').forEach(inp => {
    inp.oninput = () => updateDetailSplitTotal();
  });
  
  updateDetailSplitTotal();
  
  // 显示确认按钮
  document.getElementById('splitConfirmBar').style.display = 'flex';
}

/** 在详情面板添加空白拆分项 */
function addDetailSplitItem() {
  const container = document.getElementById('detailSplitItems');
  const div = document.createElement('div');
  div.className = 'split-item';
  div.innerHTML = `<input type="text" placeholder="子任务名称" class="split-title-input"><input type="number" value="1" min="0.5" step="0.5" class="split-hours-input"><span class="split-rm" style="cursor:pointer;color:var(--text-4)">&#10005;</span>`;
  container.appendChild(div);
  div.querySelector('.split-rm').onclick = () => { div.remove(); updateDetailSplitTotal(); };
  div.querySelector('.split-hours-input').oninput = () => updateDetailSplitTotal();
  
  // 显示确认按钮
  document.getElementById('splitConfirmBar').style.display = 'flex';
  updateDetailSplitTotal();
}

/** 更新详情面板拆分总时间 */
function updateDetailSplitTotal() {
  const inputs = document.querySelectorAll('#detailSplitItems .split-hours-input');
  const total = Array.from(inputs).reduce((s, inp) => s + (parseFloat(inp.value) || 0), 0);
  document.getElementById('detailSplitTotal').textContent = inputs.length > 0 ? `总计: ${total}h` : '';
}

/** 应用详情面板的拆分结果 */
function applyDetailSplit(id) {
  const t = tasks.find(x => x.id === id);
  const items = document.querySelectorAll('#detailSplitItems .split-item');
  const subs = [];
  items.forEach((item, i) => {
    const title = item.querySelector('.split-title-input').value.trim();
    const hours = parseFloat(item.querySelector('.split-hours-input').value) || 1;
    if (title) subs.push({ id: uid(), title, estimatedHours: hours, completed: false, order: i });
  });
  
  if (subs.length === 0) {
    toast('没有有效的子任务', 'error');
    return;
  }
  
  t.subtasks = subs;
  t.estimatedHours = subs.reduce((s, x) => s + x.estimatedHours, 0);
  saveTasks(tasks);
  renderAll();
  toast('拆分已应用');
  
  // 拆分后自动分配（如果设置开启）
  if (settings.autoAssignAfterSplit && subs.length > 0) {
    setTimeout(() => {
      autoAssignSingleTask(t);
      saveTasks(tasks);
      renderAll();
      toast('已自动分配');
    }, 300);
  }
  
  // 刷新详情
  showTaskDetail(id);
}

// ======== Task CRUD ========
function openTaskModal(id = null) {
  const modal = document.getElementById('taskModal');
  const title = document.getElementById('taskModalTitle');
  const fTitle = document.getElementById('fTitle');
  
  if (id) {
    const t = tasks.find(x => x.id === id);
    title.textContent = '编辑任务';
    document.getElementById('editId').value = id;
    fTitle.value = t.title;
    document.getElementById('fDeadline').value = t.deadline || '';
    document.getElementById('fImportance').value = t.importance || 3;
    document.getElementById('fUrgency').value = t.urgency || 3;
    document.getElementById('fNotes').value = t.notes || '';
    // 编辑模式不显示示例
    document.getElementById('titleExamples').style.display = 'none';
    fTitle.placeholder = '输入任务标题';
  } else {
    title.textContent = '新建任务';
    document.getElementById('editId').value = '';
    fTitle.value = '';
    document.getElementById('fDeadline').value = fmtDate(new Date(Date.now() + 7 * 864e5));
    document.getElementById('fImportance').value = 3;
    document.getElementById('fUrgency').value = 3;
    document.getElementById('fNotes').value = '';
    
    // 轮换显示示例
    const example = titleExamples[currentExampleIndex];
    fTitle.placeholder = `例如：${example}`;
    document.getElementById('titleExamples').textContent = `按 Tab 键填入：${example}`;
    document.getElementById('titleExamples').style.display = 'block';
    
    // 更新索引，下次显示不同的示例
    currentExampleIndex = (currentExampleIndex + 1) % titleExamples.length;
    
    // Tab 键填入示例
    fTitle.onkeydown = (e) => {
      if (e.key === 'Tab' && !fTitle.value) {
        e.preventDefault();
        fTitle.value = example;
        document.getElementById('titleExamples').style.display = 'none';
      }
    };
  }
  
  updateSliderDisplay();
  modal.classList.add('open');
  if (!id) fTitle.focus();
}

function closeTaskModal() {
  document.getElementById('taskModal').classList.remove('open');
}

function saveTask() {
  const id = document.getElementById('editId').value;
  const title = document.getElementById('fTitle').value.trim();
  const deadline = document.getElementById('fDeadline').value || null;
  const importance = parseInt(document.getElementById('fImportance').value) || 3;
  const urgency = parseInt(document.getElementById('fUrgency').value) || 3;
  const notes = document.getElementById('fNotes').value.trim();
  
  if (!title) { toast('请输入标题', 'error'); return; }
  
  const quadrant = calcQuadrant({ urgency, importance });
  
  if (id) {
    const t = tasks.find(x => x.id === id);
    t.title = title; t.deadline = deadline; t.importance = importance;
    t.urgency = urgency; t.eisenhowerQuadrant = quadrant; t.notes = notes;
  } else {
    tasks.push({
      id: uid(), title, deadline, importance, urgency,
      eisenhowerQuadrant: quadrant, estimatedHours: null,
      status: 'active', subtasks: [], notes, manualPriority: null,
      assignedDays: {}, manualOrder: tasks.length,
      createdAt: new Date().toISOString(), createdBy: 'manual'
    });
  }
  
  saveTasks(tasks);
  closeTaskModal();
  renderAll();
  toast(id ? '任务已更新' : '任务已创建');
}

function completeTask(id) {
  const t = tasks.find(x => x.id === id);
  if (t) {
    t.status = 'completed';
    t.completedAt = new Date().toISOString();
    saveTasks(tasks);
    closeDetail();
    renderAll();
    toast('任务已完成');
  }
}

function deleteTask(id) {
  showConfirm('删除任务', '确定删除此任务？', () => {
    tasks = tasks.filter(x => x.id !== id);
    saveTasks(tasks);
    selectedTaskId = null;
    renderAll();
    toast('已删除');
  });
}

function restoreTask(id) {
  const t = tasks.find(x => x.id === id);
  if (t) {
    t.status = 'active';
    delete t.completedAt;
    saveTasks(tasks);
    closeDetail();
    renderAll();
    toast('任务已恢复');
  }
}

// ======== Subtasks ========
// function toggleSubtask(tid, sid, completed) {
//   const t = tasks.find(x => x.id === tid);
//   const s = t.subtasks.find(x => x.id === sid);
//   if (s) {
//     s.completed = completed;

//     // 完成时若尚未记录实际耗时，弹窗询问
//     if (completed && s.actualMin == null) {
//       const raw = prompt('实际花费分钟数（可空跳过）');
//       if (raw !== null && raw.trim() !== '') {
//         const minutes = parseFloat(raw);
//         if (!isNaN(minutes) && minutes >= 0) {
//           s.actualMin   = minutes;
//           s.actualHours = Math.round(minutes / 60 * 10) / 10; // 保留 1 位小数
//         }
//       }
//     }

//     saveTasks(tasks);
//     renderAll();
//     if (selectedTaskId === tid) showTaskDetail(tid);
//   }
// }
function toggleSubtask(tid, sid, completed) {
  const t = tasks.find(x => x.id === tid);
  if (!t || !Array.isArray(t.subtasks)) return;

  const s = t.subtasks.find(x => x.id === sid);
  if (!s) return;

  s.completed = completed;

  // 完成时若尚未记录实际耗时，弹窗询问
  if (completed === true && (s.actualMin === null || s.actualMin === undefined)) {
    const raw = prompt('实际花费分钟数（可空跳过）');
    if (raw !== null) {
      const txt = String(raw).trim();
      if (txt !== '') {
        const minutes = parseFloat(txt);
        if (!Number.isNaN(minutes) && minutes >= 0) {
          s.actualMin = minutes;
          s.actualHours = Math.round((minutes / 60) * 10) / 10; // 1 位小数
        }
      }
    }
  }

  saveTasks(tasks);
  renderAll();
  if (selectedTaskId === tid) showTaskDetail(tid);
}

function removeSubtask(tid, sid) {
  const t = tasks.find(x => x.id === tid);
  t.subtasks = t.subtasks.filter(x => x.id !== sid);
  saveTasks(tasks);
  renderAll();
  if (selectedTaskId === tid) showTaskDetail(tid);
}

function addSubtask(tid) {
  const title = document.getElementById('newSubTitle').value.trim();
  const hours = parseFloat(document.getElementById('newSubHours').value) || 1;
  if (!title) return;
  
  const t = tasks.find(x => x.id === tid);
  t.subtasks.push({ id: uid(), title, estimatedHours: hours, completed: false, order: t.subtasks.length });
  saveTasks(tasks);
  renderAll();
  if (selectedTaskId === tid) showTaskDetail(tid);
  // 保持输入框聚焦
  setTimeout(() => {
    const input = document.getElementById('newSubTitle');
    if (input) { input.value = ''; input.focus(); }
  }, 50);
}

// ======== Split Modal (kept for backward compatibility) ========
async function openSplitModal(id) {
  splitTargetId = id;
  const t = tasks.find(x => x.id === id);
  
  const btn = document.getElementById('detailSplit');
  const originalText = btn ? btn.textContent : '拆分';
  if (btn) btn.textContent = 'AI拆分中...';
  
  try {
    const result = await parseTaskWithAI(t.title);
    if (result && result.subtasks && result.subtasks.length > 0) {
      const splitItems = document.getElementById('splitItems');
      splitItems.innerHTML = result.subtasks.map((sub, i) => `
        <div class="split-item">
          <input type="text" value="${esc(sub.title)}" class="split-title-input">
          <input type="number" value="${sub.estimatedHours || 2}" min="0.5" step="0.5" class="split-hours-input">
          <span class="split-rm" onclick="this.parentElement.remove()">&#10005;</span>
        </div>
      `).join('');
      const totalH = result.subtasks.reduce((sum, s) => sum + (s.estimatedHours || 2), 0);
      document.getElementById('splitTotalHours').value = totalH;
      updateSplitTotal();
      toast('AI 拆分完成，请确认后应用', 'success');
    } else {
      const hours = totalHours(t) || 8;
      document.getElementById('splitTotalHours').value = hours;
      regenerateSplit();
      toast('AI 拆分未返回结果，使用默认模板', 'info');
    }
  } catch (err) {
    console.error('AI 拆分失败:', err);
    const hours = totalHours(t) || 8;
    document.getElementById('splitTotalHours').value = hours;
    regenerateSplit();
    toast('AI 拆分失败，使用默认模板', 'error');
  } finally {
    if (btn) btn.textContent = originalText;
  }
  
  document.getElementById('splitModal').classList.add('open');
}

function closeSplit() {
  document.getElementById('splitModal').classList.remove('open');
  splitTargetId = null;
}

function regenerateSplit() {
  const total = parseFloat(document.getElementById('splitTotalHours').value) || 8;
  const t = tasks.find(x => x.id === splitTargetId);
  const subs = getTemplateSplit(t);
  document.getElementById('splitItems').innerHTML = subs.map((sub, i) => `
    <div class="split-item">
      <input type="text" value="${sub.title}" class="split-title-input">
      <input type="number" value="${sub.estimatedHours}" min="0.5" step="0.5" class="split-hours-input">
      <span class="split-rm" onclick="this.parentElement.remove()">&#10005;</span>
    </div>
  `).join('');
  updateSplitTotal();
}

function updateSplitTotal() {
  const inputs = document.querySelectorAll('#splitModal .split-hours-input');
  const total = Array.from(inputs).reduce((s, inp) => s + (parseFloat(inp.value) || 0), 0);
  document.getElementById('splitTotal').textContent = `总计: ${total}h`;
}

function addSplitItem() {
  const div = document.createElement('div');
  div.className = 'split-item';
  div.innerHTML = `<input type="text" placeholder="子任务名称" class="split-title-input"><input type="number" value="1" min="0.5" step="0.5" class="split-hours-input"><span class="split-rm" onclick="this.parentElement.remove()">&#10005;</span>`;
  document.getElementById('splitItems').appendChild(div);
}

function applySplit() {
  const t = tasks.find(x => x.id === splitTargetId);
  const items = document.querySelectorAll('#splitModal .split-item');
  const subs = [];
  items.forEach((item, i) => {
    const title = item.querySelector('.split-title-input').value.trim();
    const hours = parseFloat(item.querySelector('.split-hours-input').value) || 1;
    if (title) subs.push({ id: uid(), title, estimatedHours: hours, completed: false, order: i });
  });
  
  t.subtasks = subs;
  t.estimatedHours = subs.reduce((s, x) => s + x.estimatedHours, 0);
  saveTasks(tasks);
  closeSplit();
  renderAll();
  toast('拆分已应用');
  
  // 拆分后自动分配：对具体任务执行
  if (settings.autoAssignAfterSplit && subs.length > 0) {
    setTimeout(() => {
      autoAssignSingleTask(t);
      saveTasks(tasks);
      renderAll();
      toast('已自动分配');
    }, 300);
  }
}

// ======== Auto Assign ========
/** 全局自动分配：处理所有任务（包括无截止日期的任务） */
function autoAssign() {
  const active = tasks.filter(t => t.status === 'active');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const slots = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    slots[fmtDate(d)] = settings.dailyWorkHours;
  }
  
  // 减去已分配的小时数
  active.forEach(t => {
    if (t.assignedDays) {
      Object.entries(t.assignedDays).forEach(([ds, info]) => {
        const hours = typeof info === 'number' ? info : (info.hours || 0);
        if (slots[ds] !== undefined) slots[ds] -= hours;
      });
    }
  });
  
  const sorted = [...active].sort((a, b) => calcPriority(b) - calcPriority(a));
  const warns = [];
  
  sorted.forEach(t => {
    // 收集已手动分配的子任务ID
    const manuallyAssignedSubIds = new Set();
    if (t.assignedDays) {
      Object.entries(t.assignedDays).forEach(([ds, info]) => {
        if (typeof info === 'object' && info.subtaskIds) {
          info.subtaskIds.forEach(id => manuallyAssignedSubIds.add(id));
        }
      });
    }
    // 检查子任务上的手动分配标记
    t.subtasks.forEach(s => {
      if (s._manuallyAssigned) manuallyAssignedSubIds.add(s.id);
    });
    
    // 只处理未手动分配且未完成的子任务
    let items = t.subtasks.filter(s => !s.completed && !manuallyAssignedSubIds.has(s.id));
    if (!items.length) {
      // 如果没有子任务，尝试分配整个任务本身
      if (t.subtasks.length === 0 && !hasAnyAssignment(t)) {
        items = [{ id: '__whole_' + t.id, title: t.title, estimatedHours: t.estimatedHours || 1 }];
      } else {
        return;
      }
    }
    
    // 获取分配截止日期范围
    const assignmentDeadline = getAssignmentDeadline(t, today, slots);
    if (!t.assignedDays) t.assignedDays = {};
    
    items.forEach(sub => {
      let placed = false;
      for (const ds of Object.keys(slots).sort()) {
        if (assignmentDeadline && new Date(ds) > assignmentDeadline) break;
        if (slots[ds] >= (sub.estimatedHours || 1) || slots[ds] >= 0.5) {
          if (!t.assignedDays[ds]) {
            t.assignedDays[ds] = { subtaskIds: [], hours: 0 };
          }
          let dayData = t.assignedDays[ds];
          // 兼容数字格式转为对象格式
          if (typeof dayData === 'number') {
            t.assignedDays[ds] = { subtaskIds: ['__whole_' + t.id], hours: dayData };
            dayData = t.assignedDays[ds];
          }
          dayData.subtaskIds.push(sub.id);
          dayData.hours += sub.estimatedHours || 1;
          slots[ds] -= sub.estimatedHours || 1;
          placed = true;
          break;
        }
      }
      if (!placed) warns.push(t.title);
    });
  });
  
  saveTasks(tasks);
  renderAll();
  if (warns.length) toast('部分任务可能无法按时完成', 'warning');
  else toast('任务已自动分配');
}

/** 检查任务是否已有任何分配 */
function hasAnyAssignment(task) {
  if (!task.assignedDays) return false;
  return Object.keys(task.assignedDays).length > 0;
}

/** 获取任务的分配截止日期，无截止日期的任务分配到本周末 */
function getAssignmentDeadline(task, today, slots) {
  if (task.deadline) {
    const dl = new Date(task.deadline);
    dl.setHours(0, 0, 0, 0);
    return dl;
  }
  
  // 无截止日期的任务：根据四象限分配
  // Q2(重要不紧急)和Q4(不重要不紧急)分配到本周末或低负载日
  const weekStart = getWeekStart(today);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7); // 本周结束
  
  // 对于不紧急的任务，优先分配到周末
  if (task.eisenhowerQuadrant === 'Q2' || task.eisenhowerQuadrant === 'Q4') {
    // 找周末（周六周日）
    const saturday = new Date(weekStart);
    saturday.setDate(saturday.getDate() + 5);
    const sunday = new Date(weekStart);
    sunday.setDate(sunday.getDate() + 6);
    
    // 返回周日作为截止
    return sunday;
  }
  
  // 其他情况返回两周后
  const twoWeeks = new Date(today);
  twoWeeks.setDate(twoWeeks.getDate() + 14);
  return twoWeeks;
}

/** 单任务自动分配：处理单个任务（支持无截止日期） */
function autoAssignSingleTask(task) {
  const dailyHours = settings.dailyWorkHours || 4;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // 收集已手动分配的子任务ID
  const manuallyAssignedSubIds = new Set();
  if (task.assignedDays) {
    Object.values(task.assignedDays).forEach(info => {
      if (typeof info === 'object' && info.subtaskIds) {
        info.subtaskIds.forEach(id => manuallyAssignedSubIds.add(id));
      }
    });
  }
  task.subtasks.forEach(s => {
    if (s._manuallyAssigned) manuallyAssignedSubIds.add(s.id);
  });
  
  // 获取待分配的项目
  let items = task.subtasks.filter(s => !s.completed && !manuallyAssignedSubIds.has(s.id));
  if (!items.length && task.subtasks.length === 0 && !hasAnyAssignment(task)) {
    // 没有子任务，分配整个任务
    items = [{ id: '__whole_' + task.id, title: task.title, estimatedHours: task.estimatedHours || 1 }];
  }
  if (!items.length) {
    toast('没有需要分配的子任务', 'info');
    return;
  }
  
  // 获取分配截止日期
  const assignmentDeadline = getAssignmentDeadline(task, today, {});
  
  // 构建可用时间槽
  const slots = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    if (assignmentDeadline && d > assignmentDeadline) break;
    const ds = fmtDate(d);
    const existing = task.assignedDays?.[ds];
    const used = typeof existing === 'number' ? existing : (existing?.hours || 0);
    slots[ds] = dailyHours - used;
  }
  
  if (!task.assignedDays) task.assignedDays = {};
  
  for (const sub of items) {
    let remaining = sub.estimatedHours || 1;
    
    for (const ds of Object.keys(slots).sort()) {
      if (remaining <= 0) break;
      if (slots[ds] <= 0) continue;
      
      const assign = Math.min(remaining, slots[ds]);
      
      if (!task.assignedDays[ds]) {
        task.assignedDays[ds] = { subtaskIds: [], hours: 0 };
      }
      let dayData = task.assignedDays[ds];
      if (typeof dayData === 'number') {
        task.assignedDays[ds] = { subtaskIds: ['__whole_' + task.id], hours: dayData };
        dayData = task.assignedDays[ds];
      }
      if (!dayData.subtaskIds.includes(sub.id)) {
        dayData.subtaskIds.push(sub.id);
      }
      dayData.hours += assign;
      slots[ds] -= assign;
      remaining -= assign;
    }
  }
}

// ======== AI ========
/** 处理AI输入：解析后先展示预览，用户确认后才创建 */
async function handleAI() {
  const input = document.getElementById('aiInput');
  const text = input.value.trim();
  if (!text) return;
  
  const status = document.getElementById('aiStatus');
  status.textContent = '解析中...';
  
  try {
    const result = await parseTaskWithAI(text);
    status.textContent = '';
    // 改为展示预览，而不是直接创建
    showAIPreview(result);
  } catch (e) {
    status.textContent = '';
    toast('AI 解析失败: ' + e.message, 'error');
    const parsed = parseLocal(text);
    if (parsed) {
      // 同样展示预览
      showAIPreview(parsed);
    }
  }
}

function parseLocal(text) {
  let deadline = null;
  const todayD = new Date();
  const m1 = text.match(/(\d+)\s*天/);
  if (m1) { const d = new Date(todayD); d.setDate(d.getDate() + parseInt(m1[1])); deadline = fmtDate(d); }
  if (/明天/.test(text)) { const d = new Date(todayD); d.setDate(d.getDate() + 1); deadline = fmtDate(d); }
  if (/后天/.test(text)) { const d = new Date(todayD); d.setDate(d.getDate() + 2); deadline = fmtDate(d); }
  if (/下周/.test(text)) { const d = new Date(todayD); d.setDate(d.getDate() + 7); deadline = fmtDate(d); }
  const mDate = text.match(/(\d{1,2})[/\-.](\d{1,2})/);
  if (mDate && !deadline) { deadline = todayD.getFullYear() + '-' + mDate[1].padStart(2, '0') + '-' + mDate[2].padStart(2, '0'); }
  // 没有匹配到日期关键词则不设截止日期
  
  let title = text.replace(/(\d+天后?|明天|后天|下周|给自己|时间|截止|之前|之内|以内|，|。)/g, '').trim();
  if (!title) title = text.slice(0, 20);
  
  const daysLeft = deadline ? Math.round((new Date(deadline) - todayD) / 864e5) : 7;
  let urgency = daysLeft <= 1 ? 5 : daysLeft <= 3 ? 4 : daysLeft <= 7 ? 3 : daysLeft <= 14 ? 2 : 1;
  
  return { title, deadline, urgency, importance: 3, estimatedHours: 6, subtasks: [], reasoning: '关键词解析' };
}

/** 显示AI解析预览，用户确认后才创建任务 */
function showAIPreview(data) {
  const el = document.getElementById('aiPreview');
  let subsHtml = data.subtasks && data.subtasks.length ? data.subtasks.map((s, i) => `
    <div class="ai-sub-item" style="display:flex;gap:8px;align-items:center;margin:4px 0;">
      <input type="text" class="ai-sub-title" data-idx="${i}" value="${esc(s.title)}" style="flex:1;background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);font-size:12px;">
      <input type="number" class="ai-sub-hours" data-idx="${i}" value="${s.estimatedHours}" min="0.5" step="0.5" style="width:60px;background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);font-size:12px;">
      <span style="color:var(--text-3);font-size:11px;">h</span>
    </div>
  `).join('') : '<div class="ai-sub-item" style="color:var(--text-4)">无子任务建议</div>';
  
  el.innerHTML = `<h4>任务解析结果</h4>
    <div class="ai-field"><span class="af-label">标题</span><input type="text" id="aiEditTitle" class="af-val" value="${esc(data.title)}" style="background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);flex:1;"></div>
    <div class="ai-field"><span class="af-label">截止</span><input type="date" id="aiEditDeadline" class="af-val" value="${data.deadline || ''}" style="background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);"></div>
    <div class="ai-field"><span class="af-label">紧急</span><input type="number" id="aiEditUrgency" class="af-val" value="${data.urgency}" min="1" max="5" style="width:60px;background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);"></div>
    <div class="ai-field"><span class="af-label">重要</span><input type="number" id="aiEditImportance" class="af-val" value="${data.importance}" min="1" max="5" style="width:60px;background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);"></div>
    <div class="ai-field"><span class="af-label">预估</span><input type="number" id="aiEditHours" class="af-val" value="${data.estimatedHours}" min="0.5" step="0.5" style="width:80px;background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);"><span style="margin-left:4px;color:var(--text-3);">h</span></div>
    <div class="ai-subs" style="margin:10px 0;padding:8px;background:var(--bg-2);border-radius:6px;">
      <div style="font-size:11px;color:var(--text-3);margin-bottom:6px;">子任务 (可编辑)</div>
      ${subsHtml}
    </div>
    <div class="ai-preview-actions">
      <button class="dbtn" id="aiPreviewCancel">取消</button>
      <button class="dbtn dbtn-primary" id="aiPreviewCreate">确认创建</button>
    </div>`;
  
  el._data = data;
  el.classList.add('open');
  
  document.getElementById('aiPreviewCancel').onclick = closeAIPreview;
  document.getElementById('aiPreviewCreate').onclick = createFromAI;
}

function closeAIPreview() {
  document.getElementById('aiPreview').classList.remove('open');
}

/** 从AI预览创建任务（用户点击确认后） */
function createFromAI() {
  const el = document.getElementById('aiPreview');
  const originalData = el._data; if (!originalData) return;
  
  const title = document.getElementById('aiEditTitle').value.trim();
  const deadline = document.getElementById('aiEditDeadline').value || null;
  const urgency = parseInt(document.getElementById('aiEditUrgency').value) || 3;
  const importance = parseInt(document.getElementById('aiEditImportance').value) || 3;
  const estimatedHours = parseFloat(document.getElementById('aiEditHours').value) || 2;
  
  if (!title) { toast('请输入标题', 'error'); return; }
  
  const subs = [];
  document.querySelectorAll('.ai-sub-title').forEach(input => {
    const idx = input.dataset.idx;
    const hoursInput = document.querySelector(`.ai-sub-hours[data-idx="${idx}"]`);
    const subTitle = input.value.trim();
    const subHours = parseFloat(hoursInput?.value) || 1;
    if (subTitle) {
      subs.push({ id: uid(), title: subTitle, estimatedHours: subHours, completed: false, order: subs.length });
    }
  });
  
  const q = calcQuadrant({ urgency, importance });
  const totalH = subs.reduce((s, x) => s + x.estimatedHours, 0) || estimatedHours || 0;
  const t = {
    id: uid(), title, deadline, estimatedHours: totalH, importance, urgency,
    eisenhowerQuadrant: q, status: 'active', subtasks: subs, notes: '',
    manualPriority: null, assignedDays: {}, manualOrder: tasks.length,
    createdAt: new Date().toISOString(), createdBy: 'ai',
    aiContext: { ...originalData, edited: true }
  };
  tasks.push(t);
  saveTasks(tasks);
  closeAIPreview();
  document.getElementById('aiInput').value = '';
  renderAll();
  toast('任务已创建');
  
  // 自动分配（如果有子任务）
  if (settings.autoAssignAfterSplit && subs.length) {
    setTimeout(() => {
      autoAssignSingleTask(t);
      saveTasks(tasks);
      renderAll();
      toast('已自动分配');
    }, 300);
  }
}

// ======== Settings ========
function openSettings() {
  document.getElementById('sDailyH').value = settings.dailyWorkHours;
  document.getElementById('sSplitT').value = settings.splitThreshold;
  document.getElementById('sAutoAssign').value = String(settings.autoAssignAfterSplit);
  document.getElementById('settingsModal').classList.add('open');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('open');
}

function saveSettingsHandler() {
  settings.dailyWorkHours = parseFloat(document.getElementById('sDailyH').value) || 4;
  settings.splitThreshold = parseInt(document.getElementById('sSplitT').value) || 6;
  settings.autoAssignAfterSplit = document.getElementById('sAutoAssign').value === 'true';
  saveSettings(settings);
  closeSettingsModal();
  toast('设置已保存');
}

// ======== Filter ========
function toggleFilter() {
  const filters = [null, 'Q1', 'Q2', 'Q3', 'Q4'];
  const currentIdx = filters.indexOf(activeFilter);
  activeFilter = filters[(currentIdx + 1) % filters.length];
  renderSidebar();
}

// ======== Export/Import ========
function exportData() {
  const blob = new Blob([JSON.stringify({ tasks, settings, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bugule-backup-' + fmtDate(new Date()) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已导出');
}

function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = function(ev) {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.tasks && Array.isArray(data.tasks)) {
        showConfirm('导入数据', '将覆盖当前数据，确定？', () => {
          tasks = data.tasks;
          if (data.settings) settings = { ...settings, ...data.settings };
          saveTasks(tasks);
          saveSettings(settings);
          migrateTasks();
          renderAll();
          toast('已导入');
        });
      } else toast('无效文件', 'error');
    } catch { toast('解析失败', 'error'); }
  };
  r.readAsText(file);
  e.target.value = '';
}

// ======== Confirm / Toast ========
/** 显示确认对话框 */
function showConfirm(title, msg, cb, okText) {
  document.getElementById('cfmTitle').textContent = title;
  document.getElementById('cfmMsg').textContent = msg;
  confirmCb = cb;
  
  const okBtn = document.getElementById('cfmOk');
  okBtn.textContent = okText || '确认';
  okBtn.onclick = () => { 
    const callback = confirmCb;  // 先保存回调
    closeConfirm();  // 关闭对话框（会清空confirmCb）
    if (callback) callback();  // 执行保存的回调
  };
  
  document.getElementById('confirmModal').classList.add('open');
}

function closeConfirm() {
  document.getElementById('confirmModal').classList.remove('open');
  confirmCb = null;
  confirmCb2 = null;
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast t-' + type;
  el.textContent = msg;
  document.getElementById('toastBox').appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// ======== Slider Display ========
function updateSliderDisplay() {
  document.getElementById('fImpVal').textContent = document.getElementById('fImportance').value;
  document.getElementById('fUrgVal').textContent = document.getElementById('fUrgency').value;
  
  const u = parseInt(document.getElementById('fUrgency').value) || 3;
  const i = parseInt(document.getElementById('fImportance').value) || 3;
  const q = calcQuadrant({ urgency: u, importance: i });
  const qPreview = document.getElementById('qPreview');
  qPreview.textContent = Q_LABELS[q];
  qPreview.className = 'quadrant-preview ' + getQClass(q);
}

// ======== Sort Change ========
function handleSortChange(e) {
  sortMode = e.target.value;
  settings.defaultSortMode = sortMode;
  saveSettings(settings);
  renderSidebar();
}

// ======== Pomodoro Timer ========
let pomodoroTimer = null;
let pomodoroTimeLeft = 0;
let pomodoroTotalTime = 0;
let pomodoroTaskId = null;
let pomodoroSubtaskId = null;

function openPomodoroTimer(taskId, subtaskId) {
  pomodoroTaskId = taskId;
  pomodoroSubtaskId = subtaskId;
  
  const task = tasks.find(t => t.id === taskId);
  const subtask = task?.subtasks?.find(s => s.id === subtaskId);
  
  // 更新任务选择下拉框
  const select = document.getElementById('tomatoTaskSelect');
  select.innerHTML = `<option value="${taskId}|${subtaskId}">${subtask ? subtask.title : task?.title}</option>`;
  select.value = `${taskId}|${subtaskId}`;
  
  // 重置计时器显示
  resetPomodoroDisplay();
  
  document.getElementById('tomatoModal').classList.add('open');
}

function resetPomodoroDisplay() {
  const duration = parseInt(document.getElementById('tomatoDuration').value) || 25;
  pomodoroTimeLeft = duration * 60;
  pomodoroTotalTime = pomodoroTimeLeft;
  updatePomodoroDisplay();
  document.getElementById('tomatoStatus').textContent = '准备开始';
  document.getElementById('tomatoBar').style.width = '0%';
  document.getElementById('tomatoStart').style.display = 'inline-block';
  document.getElementById('tomatoPause').style.display = 'none';
  document.getElementById('tomatoComplete').style.display = 'none';
}

function updatePomodoroDisplay() {
  const mins = Math.floor(pomodoroTimeLeft / 60).toString().padStart(2, '0');
  const secs = (pomodoroTimeLeft % 60).toString().padStart(2, '0');
  document.getElementById('tomatoTime').textContent = `${mins}:${secs}`;
  
  const progress = ((pomodoroTotalTime - pomodoroTimeLeft) / pomodoroTotalTime) * 100;
  document.getElementById('tomatoBar').style.width = `${progress}%`;
}

function startPomodoro() {
  if (pomodoroTimeLeft <= 0) resetPomodoroDisplay();
  
  document.getElementById('tomatoStatus').textContent = '专注中...';
  document.getElementById('tomatoStart').style.display = 'none';
  document.getElementById('tomatoPause').style.display = 'inline-block';
  document.getElementById('tomatoComplete').style.display = 'none';
  
  pomodoroTimer = setInterval(() => {
    pomodoroTimeLeft--;
    updatePomodoroDisplay();
    
    if (pomodoroTimeLeft <= 0) {
      completePomodoro();
    }
  }, 1000);
}

function pausePomodoro() {
  clearInterval(pomodoroTimer);
  document.getElementById('tomatoStatus').textContent = '已暂停';
  document.getElementById('tomatoStart').style.display = 'inline-block';
  document.getElementById('tomatoPause').style.display = 'none';
}

function stopPomodoro() {
  clearInterval(pomodoroTimer);
  resetPomodoroDisplay();
}

function completePomodoro() {
  clearInterval(pomodoroTimer);
  document.getElementById('tomatoStatus').textContent = '专注完成！';
  document.getElementById('tomatoStart').style.display = 'none';
  document.getElementById('tomatoPause').style.display = 'none';
  document.getElementById('tomatoComplete').style.display = 'inline-block';
  
  // 记录实际耗时到子任务
  if (pomodoroTaskId && pomodoroSubtaskId) {
    const task = tasks.find(t => t.id === pomodoroTaskId);
    const subtask = task?.subtasks?.find(s => s.id === pomodoroSubtaskId);
    if (subtask) {
      const actualMinutes = Math.round(pomodoroTotalTime / 60);
      subtask.actualHours = (subtask.actualHours || 0) + (actualMinutes / 60);
      saveTasks(tasks);
      toast(`已记录 ${actualMinutes} 分钟专注时间`, 'success');
    }
  }
}

function closePomodoro() {
  clearInterval(pomodoroTimer);
  document.getElementById('tomatoModal').classList.remove('open');
  pomodoroTaskId = null;
  pomodoroSubtaskId = null;
}

// ======== Subtask Detail ========
function showSubtaskDetail(taskId, subtaskId) {
  const task = tasks.find(t => t.id === taskId);
  const subtask = task?.subtasks?.find(s => s.id === subtaskId);
  if (!subtask) return;
  
  // 填充详情面板
  document.getElementById('detailTitleInput').value = subtask.title;
  document.getElementById('detailBody').innerHTML = `
    <div class="detail-section">
      <label>所属任务</label>
      <div class="detail-value">${esc(task.title)}</div>
    </div>
    <div class="detail-section">
      <label>预计耗时</label>
      <div class="detail-value">${formatDuration(subtask.estimatedHours)}</div>
    </div>
    <div class="detail-section">
      <label>实际耗时</label>
      <div class="detail-value">${formatDuration(subtask.actualHours || 0)}</div>
    </div>
    <div class="detail-section">
      <label>完成状态</label>
      <div class="detail-value">${subtask.completed ? '已完成' : '进行中'}</div>
    </div>
    <div class="detail-actions-row" style="margin-top:20px">
      <button class="dbtn dbtn-primary" onclick="startPomodoroForSubtask('${taskId}', '${subtaskId}')">🍅 开始番茄钟</button>
      <button class="dbtn ${subtask.completed ? '' : 'dbtn-success'}" onclick="toggleSubtaskComplete('${taskId}', '${subtaskId}')">${subtask.completed ? '标记未完成' : '✓ 标记完成'}</button>
    </div>
  `;
  
  document.getElementById('detailMask').classList.add('open');
  document.getElementById('detailPanel').classList.add('open');
  
  // 绑定关闭事件
  document.getElementById('detailClose').onclick = closeDetail;
  document.getElementById('detailMask').onclick = closeDetail;
}

function startPomodoroForSubtask(taskId, subtaskId) {
  closeDetail();
  openPomodoroTimer(taskId, subtaskId);
}

function toggleSubtaskComplete(taskId, subtaskId) {
  const task = tasks.find(t => t.id === taskId);
  const subtask = task?.subtasks?.find(s => s.id === subtaskId);
  if (subtask) {
    subtask.completed = !subtask.completed;
    saveTasks(tasks);
    renderAll();
    closeDetail();
    toast(subtask.completed ? '子任务已完成' : '子任务已恢复', 'success');
  }
}

function completeSubtask(taskId, subtaskId) {
  toggleSubtaskComplete(taskId, subtaskId);
}

// ======== Event Listeners ========
function setupListeners() {
  // View toggle
  document.getElementById('viewMonth').onclick = () => setView('month');
  document.getElementById('viewWeek').onclick = () => setView('week');
  document.getElementById('viewToday').onclick = () => setView('today');
  
  // Navigation
  document.getElementById('navPrev').onclick = navPrev;
  document.getElementById('navNext').onclick = navNext;
  document.getElementById('navToday').onclick = navToday;
  
  // Sort
  document.getElementById('sortSelect').onchange = handleSortChange;
  
  // Task modal (for new tasks only)
  document.getElementById('newTaskBtn').onclick = () => openTaskModal();
  document.getElementById('taskModalClose').onclick = closeTaskModal;
  document.getElementById('taskModalCancel').onclick = closeTaskModal;
  document.getElementById('taskModalSave').onclick = saveTask;
  
  // Split modal (backward compat)
  document.getElementById('splitModalClose').onclick = closeSplit;
  document.getElementById('splitModalSkip').onclick = closeSplit;
  document.getElementById('splitModalApply').onclick = applySplit;
  document.getElementById('addSplitItemBtn').onclick = addSplitItem;
  document.getElementById('splitTotalHours').onchange = regenerateSplit;
  
  // Settings
  document.getElementById('settingsBtn').onclick = openSettings;
  document.getElementById('settingsModalClose').onclick = closeSettingsModal;
  document.getElementById('settingsModalCancel').onclick = closeSettingsModal;
  document.getElementById('settingsModalSave').onclick = saveSettingsHandler;
  
  // Filter
  document.getElementById('filterBtn').onclick = toggleFilter;
  
  // Sidebar completed
  document.getElementById('sidebarCompletedToggle').onclick = toggleSidebarCompleted;
  
  // Auto assign
  document.getElementById('autoAssignBtn').onclick = autoAssign;
  
  // AI
  document.getElementById('aiSendBtn').onclick = handleAI;
  document.getElementById('aiInput').onkeydown = e => { if (e.key === 'Enter') handleAI(); };
  
  // Export/Import
  document.getElementById('exportBtn').onclick = exportData;
  document.getElementById('importBtn').onclick = () => document.getElementById('impFile').click();
  document.getElementById('impFile').onchange = importData;
  
  // Confirm
  document.getElementById('confirmModalClose').onclick = closeConfirm;
  document.getElementById('confirmModalCancel').onclick = closeConfirm;
  
  // Tomato Timer
  document.getElementById('tomatoModalClose').onclick = closePomodoro;
  document.getElementById('tomatoStart').onclick = startPomodoro;
  document.getElementById('tomatoPause').onclick = pausePomodoro;
  document.getElementById('tomatoStop').onclick = stopPomodoro;
  document.getElementById('tomatoComplete').onclick = () => { closePomodoro(); toast('番茄钟完成！', 'success'); };
  document.getElementById('tomatoDuration').onchange = resetPomodoroDisplay;
  
  // User Menu
  const userAvatar = document.getElementById('userAvatar');
  const userDropdown = document.getElementById('userDropdown');
  
  userAvatar.onclick = (e) => {
    e.stopPropagation();
    userDropdown.classList.toggle('open');
  };
  
  document.addEventListener('click', (e) => {
    if (!userDropdown.contains(e.target) && e.target !== userAvatar) {
      userDropdown.classList.remove('open');
    }
  });
  
  document.querySelectorAll('.user-menu-item').forEach(item => {
    item.onclick = () => {
      const action = item.dataset.action;
      userDropdown.classList.remove('open');
      
      switch(action) {
        case 'profile':
          toast('个人资料功能开发中...', 'info');
          break;
        case 'history':
          toast('历史任务功能开发中...', 'info');
          break;
        case 'account':
          toast('账号密码功能开发中...', 'info');
          break;
        case 'about':
          toast('不咕了 v2.1 - 让DDL成为第一生产力', 'success');
          break;
      }
    };
  });
  
  // Sliders
  document.getElementById('fImportance').oninput = updateSliderDisplay;
  document.getElementById('fUrgency').oninput = updateSliderDisplay;
  
  // Keyboard shortcuts
  document.onkeydown = e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); document.getElementById('aiInput').focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); openTaskModal(); }
    if (e.key === 'Escape') {
      closeTaskModal(); closeSplit(); closeSettingsModal(); closeConfirm(); closeAIPreview(); closeDetail();
    }
  };
  
  // Modal backgrounds
  document.querySelectorAll('.modal-bg').forEach(bg => {
    bg.onclick = e => { if (e.target === bg) bg.classList.remove('open'); };
  });
  
  // Matrix filter
  document.getElementById('matrixGrid').onclick = e => {
    const cell = e.target.closest('.matrix-cell');
    if (cell) {
      const q = cell.dataset.q;
      activeFilter = activeFilter === q ? null : q;
      renderSidebar();
      renderPanel();
    }
  };
}

// ======== Start ========
init();
