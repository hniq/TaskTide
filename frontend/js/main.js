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

const SLOT_EPSILON = 1e-6;
const WEEKDAY_PICKER = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' }
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getEstimateMultiplier() {
  const persistedTasks = loadTasks();
  const ratios = [];

  persistedTasks.forEach(task => {
    if (!task || !Array.isArray(task.subtasks)) return;
    task.subtasks.forEach(sub => {
      const actual = Number(sub?.actualHours);
      const estimated = Number(sub?.estimatedHours);
      if (
        Number.isFinite(actual) &&
        actual > 0 &&
        Number.isFinite(estimated) &&
        estimated > 0
      ) {
        ratios.push(actual / estimated);
      }
    });
  });

  if (!ratios.length) return 1;
  const avgRatio = ratios.reduce((sum, v) => sum + v, 0) / ratios.length;
  return clamp(avgRatio, 0.7, 2.5);
}
window.getEstimateMultiplier = getEstimateMultiplier;

function getAdjustedHours(hours, multiplier = 1) {
  const value = Number(hours);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number((value * multiplier).toFixed(2));
}

function adjustSubtasksForEstimate(subtasks) {
  if (!Array.isArray(subtasks)) return [];
  const multiplier = getEstimateMultiplier();
  return subtasks.map(sub => ({
    ...sub,
    estimatedHours: getAdjustedHours(sub?.estimatedHours || 1, multiplier)
  }));
}

function applyEstimateMultiplierToWholeTaskItems(items, multiplier) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    const isWholeTask = String(item?.id || '').startsWith('__whole_');
    if (!isWholeTask) return item;
    const rawHours = Number(item?.estimatedHours);
    const safeHours = Number.isFinite(rawHours) && rawHours > 0 ? rawHours : 1;
    return {
      ...item,
      estimatedHours: getAdjustedHours(safeHours, multiplier)
    };
  });
}
function roundHours(hours) {
  const value = Number(hours);
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, value).toFixed(2));
}

function parseTimeToMinutes(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function minutesToTime(minutes) {
  const total = Math.max(0, Math.min(24 * 60, Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeWeeklyAvailabilitySlots(slots) {
  if (!Array.isArray(slots)) return [];
  const dedupe = new Set();
  const normalized = [];

  slots.forEach(slot => {
    const dayRaw = slot?.weekday ?? slot?.dayOfWeek;
    const dayOfWeek = Number(dayRaw);
    const startMin = parseTimeToMinutes(String(slot?.start || ''));
    const endMin = parseTimeToMinutes(String(slot?.end || ''));
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return;
    if (startMin == null || endMin == null || endMin <= startMin) return;

    const safe = {
      weekday: dayOfWeek,
      dayOfWeek,
      start: minutesToTime(startMin),
      end: minutesToTime(endMin)
    };
    const key = `${safe.dayOfWeek}|${safe.start}|${safe.end}`;
    if (!dedupe.has(key)) {
      dedupe.add(key);
      normalized.push(safe);
    }
  });

  normalized.sort((a, b) =>
    (a.dayOfWeek - b.dayOfWeek) ||
    (parseTimeToMinutes(a.start) - parseTimeToMinutes(b.start))
  );
  return normalized;
}

function syncWeeklyAvailabilitySettingsObject(settingsObj) {
  if (!settingsObj || typeof settingsObj !== 'object') return false;
  const beforeWeekly = JSON.stringify(settingsObj.weeklyAvailability || []);
  const beforeWeeklySlots = JSON.stringify(settingsObj.weeklyAvailabilitySlots || []);
  const source = Array.isArray(settingsObj.weeklyAvailability) && settingsObj.weeklyAvailability.length
    ? settingsObj.weeklyAvailability
    : settingsObj.weeklyAvailabilitySlots;
  const normalized = normalizeWeeklyAvailabilitySlots(source || []);

  settingsObj.weeklyAvailability = normalized.map(slot => ({
    weekday: slot.weekday,
    start: slot.start,
    end: slot.end
  }));
  settingsObj.weeklyAvailabilitySlots = normalized.map(slot => ({
    dayOfWeek: slot.dayOfWeek,
    start: slot.start,
    end: slot.end
  }));

  return (
    beforeWeekly !== JSON.stringify(settingsObj.weeklyAvailability) ||
    beforeWeeklySlots !== JSON.stringify(settingsObj.weeklyAvailabilitySlots)
  );
}

function getActiveWeeklyAvailabilitySlots() {
  const source = (Array.isArray(settings.weeklyAvailability) && settings.weeklyAvailability.length)
    ? settings.weeklyAvailability
    : settings.weeklyAvailabilitySlots;
  return normalizeWeeklyAvailabilitySlots(source || []);
}

function getConfiguredSlotLabelsForDate(dateInput, weeklySlots = null) {
  const slots = weeklySlots ?? getActiveWeeklyAvailabilitySlots();
  if (!slots.length) return [];
  const date = typeof dateInput === 'string'
    ? new Date(`${dateInput}T00:00:00`)
    : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return [];
  const day = date.getDay();
  return slots
    .filter(slot => slot.dayOfWeek === day)
    .map(slot => `${slot.start}-${slot.end}`);
}

function getDefaultSlotLabelForDate(dateInput, weeklySlots = null) {
  const labels = getConfiguredSlotLabelsForDate(dateInput, weeklySlots);
  return labels[0] || '';
}

function getSlotLabelFromSlot(slot) {
  if (!slot) return '';
  const startMin = Number(slot.startMin);
  const endMin = Number(slot.endMin);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return '';
  return `${minutesToTime(startMin)}-${minutesToTime(endMin)}`;
}

function getDailyCapacityForDate(dateInput, weeklySlots = null) {
  const slots = weeklySlots ?? getActiveWeeklyAvailabilitySlots();
  if (!slots.length) return Number(settings.dailyWorkHours) || 4;

  const date = typeof dateInput === 'string'
    ? new Date(`${dateInput}T00:00:00`)
    : new Date(dateInput);
  const day = date.getDay();
  let totalMinutes = 0;

  slots.forEach(slot => {
    if (slot.dayOfWeek !== day) return;
    const startMin = parseTimeToMinutes(slot.start);
    const endMin = parseTimeToMinutes(slot.end);
    if (startMin == null || endMin == null || endMin <= startMin) return;
    totalMinutes += (endMin - startMin);
  });
  return roundHours(totalMinutes / 60);
}

function getUsedHoursByDate(taskList) {
  const used = {};
  taskList.forEach(task => {
    if (!task?.assignedDays) return;
    Object.entries(task.assignedDays).forEach(([ds, info]) => {
      const hours = typeof info === 'number' ? Number(info) : Number(info?.hours || 0);
      if (!Number.isFinite(hours) || hours <= 0) return;
      used[ds] = roundHours((used[ds] || 0) + hours);
    });
  });
  return used;
}

function buildCapacitySlots({
  startDate,
  assignmentDeadline = null,
  maxDays = 30,
  weeklySlots = null,
  usedHoursByDate = {},
  fallbackDailyHours = 4
}) {
  const normalizedWeeklySlots = weeklySlots ?? getActiveWeeklyAvailabilitySlots();
  const useWeeklySlots = normalizedWeeklySlots.length > 0;

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const maxDate = assignmentDeadline ? new Date(assignmentDeadline) : null;
  if (maxDate) maxDate.setHours(0, 0, 0, 0);

  const slotList = [];
  for (let i = 0; i < maxDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (maxDate && d > maxDate) break;

    const ds = fmtDate(d);
    if (useWeeklySlots) {
      const day = d.getDay();
      const dateRules = normalizedWeeklySlots.filter(x => x.dayOfWeek === day);
      dateRules.forEach((rule, index) => {
        const startMin = parseTimeToMinutes(rule.start);
        const endMin = parseTimeToMinutes(rule.end);
        if (startMin == null || endMin == null || endMin <= startMin) return;
        const capacity = roundHours((endMin - startMin) / 60);
        if (capacity <= 0) return;
        slotList.push({
          key: `${ds}|${startMin}|${endMin}|${index}`,
          dateStr: ds,
          dateObj: new Date(d),
          startMin,
          endMin,
          capacity,
          remaining: capacity
        });
      });
    } else {
      const capacity = roundHours(Number(fallbackDailyHours) || 0);
      if (capacity <= 0) continue;
      slotList.push({
        key: `${ds}|daily`,
        dateStr: ds,
        dateObj: new Date(d),
        startMin: 0,
        endMin: null,
        capacity,
        remaining: capacity
      });
    }
  }

  const slotsByDate = new Map();
  slotList.forEach(slot => {
    if (!slotsByDate.has(slot.dateStr)) slotsByDate.set(slot.dateStr, []);
    slotsByDate.get(slot.dateStr).push(slot);
  });

  slotsByDate.forEach((dateSlots, ds) => {
    let used = Number(usedHoursByDate[ds]) || 0;
    if (used <= 0) return;
    dateSlots.sort((a, b) => a.startMin - b.startMin);
    for (const slot of dateSlots) {
      if (used <= SLOT_EPSILON) break;
      const consumed = Math.min(slot.remaining, used);
      slot.remaining = roundHours(slot.remaining - consumed);
      used = roundHours(used - consumed);
    }
  });

  return slotList
    .filter(slot => slot.remaining > SLOT_EPSILON)
    .sort((a, b) => (a.dateObj - b.dateObj) || (a.startMin - b.startMin));
}

function buildAvailableSlots(settingsObj, today, assignmentDeadline, existingAssignedDays, maxDays = 30) {
  const safeSettings = settingsObj || {};
  const weeklySource = (Array.isArray(safeSettings.weeklyAvailability) && safeSettings.weeklyAvailability.length)
    ? safeSettings.weeklyAvailability
    : safeSettings.weeklyAvailabilitySlots;
  const weeklySlots = normalizeWeeklyAvailabilitySlots(weeklySource || []);
  return buildCapacitySlots({
    startDate: today,
    assignmentDeadline,
    maxDays,
    weeklySlots,
    usedHoursByDate: existingAssignedDays || {},
    fallbackDailyHours: Number(safeSettings.dailyWorkHours) || 4
  });
}

function ensureDayAssignmentObject(task, dateStr) {
  if (!task.assignedDays) task.assignedDays = {};
  if (!task.assignedDays[dateStr]) {
    task.assignedDays[dateStr] = { subtaskIds: [], hours: 0, slotBySubtaskId: {} };
  }
  if (typeof task.assignedDays[dateStr] === 'number') {
    task.assignedDays[dateStr] = {
      subtaskIds: ['__whole_' + task.id],
      hours: Number(task.assignedDays[dateStr]) || 0,
      slotBySubtaskId: {}
    };
  }
  if (!Array.isArray(task.assignedDays[dateStr].subtaskIds)) {
    task.assignedDays[dateStr].subtaskIds = [];
  }
  if (!Number.isFinite(Number(task.assignedDays[dateStr].hours))) {
    task.assignedDays[dateStr].hours = 0;
  }
  if (
    !task.assignedDays[dateStr].slotBySubtaskId ||
    typeof task.assignedDays[dateStr].slotBySubtaskId !== 'object' ||
    Array.isArray(task.assignedDays[dateStr].slotBySubtaskId)
  ) {
    task.assignedDays[dateStr].slotBySubtaskId = {};
  }
  return task.assignedDays[dateStr];
}

function appendAssignment(task, dateStr, subtaskId, hours, slotLabel = '') {
  const assignHours = roundHours(hours);
  if (assignHours <= 0) return;
  const dayData = ensureDayAssignmentObject(task, dateStr);
  if (!dayData.subtaskIds.includes(subtaskId)) {
    dayData.subtaskIds.push(subtaskId);
  }
  dayData.hours = roundHours((dayData.hours || 0) + assignHours);
  const safeLabel = String(slotLabel || '').trim();
  if (!safeLabel) return;
  const current = String(dayData.slotBySubtaskId[subtaskId] || '').trim();
  if (!current) {
    dayData.slotBySubtaskId[subtaskId] = safeLabel;
    return;
  }
  const labels = current.split(' / ').map(item => item.trim()).filter(Boolean);
  if (labels.includes(safeLabel)) return;
  labels.push(safeLabel);
  dayData.slotBySubtaskId[subtaskId] = labels.join(' / ');
}

function getSubtaskGroupKey(title) {
  let key = String(title || '').trim();
  const sessionPattern = /\s*\(?\d+\/\d+\)?\s*$/;
  key = key.replace(sessionPattern, '').trim();
  const indexSuffixPattern = /(?:\(|\uFF08)\d+(?:\)|\uFF09)\s*$/;
  while (indexSuffixPattern.test(key)) {
    key = key.replace(indexSuffixPattern, '').trim();
  }
  return classifySubtaskGroup(key);
}

function classifySubtaskGroup(title) {
  const text = String(title || '').toLowerCase();
  if (!text) return 'other';
  if (/\u6587\u732E|\u9605\u8BFB|\u67E5\u8D44\u6599|read|literature/i.test(text)) return 'reading';
  if (/\u521D\u7A3F|\u5199\u4F5C|\u64B0\u5199|write|draft/i.test(text)) return 'writing';
  if (/\u4FEE\u6539|\u6DA6\u8272|\u5B8C\u5584|revise|polish/i.test(text)) return 'revise';
  if (/\u6392\u7248|\u683C\u5F0F|format/i.test(text)) return 'format';
  return 'other';
}

function interleaveSubtasksByGroup(items) {
  const groups = new Map();
  const order = [];
  items.forEach(item => {
    const key = getSubtaskGroupKey(item.title);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(item);
  });

  const mixed = [];
  let hasNext = true;
  while (hasNext) {
    hasNext = false;
    order.forEach(key => {
      const list = groups.get(key);
      if (!list || !list.length) return;
      mixed.push(list.shift());
      hasNext = true;
    });
  }
  return mixed;
}

function pickSlotForGroup(slotList, assignmentDeadline, slotGroupState, slotTaskDateState, groupKey, taskId) {
  let bestSlot = null;
  let bestRank = Number.POSITIVE_INFINITY;
  const usedDates = slotTaskDateState.get(taskId) || new Set();

  for (const slot of slotList) {
    if (slot.remaining <= SLOT_EPSILON) continue;
    if (assignmentDeadline && slot.dateObj > assignmentDeadline) break;

    const usedGroups = slotGroupState.get(slot.key);
    const hasGroupInSlot = !!(usedGroups && usedGroups.has(groupKey));
    const hasTaskOnDate = usedDates.has(slot.dateStr);

    let rank = 3;
    if (!hasGroupInSlot && !hasTaskOnDate) rank = 0;
    else if (!hasGroupInSlot && hasTaskOnDate) rank = 1;
    else if (hasGroupInSlot && !hasTaskOnDate) rank = 2;

    if (rank < bestRank) {
      bestRank = rank;
      bestSlot = slot;
      if (rank === 0) break;
    }
  }

  return bestSlot;
}

function assignSubtaskToCapacitySlots(task, sub, slotList, assignmentDeadline, slotGroupState, slotTaskDateState) {
  let remaining = roundHours(Number(sub.estimatedHours) || 1);
  const groupKey = getSubtaskGroupKey(sub.title);

  while (remaining > SLOT_EPSILON) {
    const slot = pickSlotForGroup(
      slotList,
      assignmentDeadline,
      slotGroupState,
      slotTaskDateState,
      groupKey,
      task.id
    );
    if (!slot) break;
    const assign = Math.min(remaining, slot.remaining);
    appendAssignment(task, slot.dateStr, sub.id, assign, getSlotLabelFromSlot(slot));
    slot.remaining = roundHours(slot.remaining - assign);
    remaining = roundHours(remaining - assign);

    let groups = slotGroupState.get(slot.key);
    if (!groups) {
      groups = new Set();
      slotGroupState.set(slot.key, groups);
    }
    groups.add(groupKey);

    let taskDates = slotTaskDateState.get(task.id);
    if (!taskDates) {
      taskDates = new Set();
      slotTaskDateState.set(task.id, taskDates);
    }
    taskDates.add(slot.dateStr);
  }

  return remaining <= SLOT_EPSILON;
}

// ======== State ========
let tasks = [];
let settings = {};
let currentView = 'month';
let viewDate = new Date();
let selectedTaskId = null;
let splitTargetId = null;
let activeFilter = null;
let confirmCb = null;
let confirmCb2 = null;  // 2026.03.05 17:13 - 新增二次确认回调
let sortMode = 'deadline'; // 'deadline' | 'priority' | 'manual'

// ======== Drag State ========
let draggedTaskId = null;
let draggedSubtaskId = null;
let sidebarDragId = null;       // 侧边栏任务拖拽排序
let detailSubDragId = null;     // 详情面板子任务拖拽排序

// ======== Init ========
/** 初始化应用：加载数据，设置事件监听器，首次渲染 **/
function init() {
  settings = loadSettings();
  const normalizedSettingsChanged = syncWeeklyAvailabilitySettingsObject(settings);
  if (normalizedSettingsChanged) saveSettings(settings);
  tasks = loadTasks();
  migrateTasks();
  sortMode = settings.defaultSortMode || 'deadline';
  currentView = settings.defaultCalendarView || 'month';
  viewDate = new Date();
  renderAll();
  setupListeners();
  registerQAHooks();
}

/** 迁移任务数据 **/
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
/** 渲染侧边栏 */
function renderSidebar() {
  const list = document.getElementById('taskList');
  let active = tasks.filter(t => t.status === 'active');
  if (activeFilter) active = active.filter(t => t.eisenhowerQuadrant === activeFilter);

  //
  active = sortTaskList(active);

  // 
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) sortSelect.value = sortMode;

  if (!active.length) {
    list.innerHTML = '<div class="sidebar-empty">暂无任务</div>';
  } else {
    let html = active.map((t, idx) => {
      const dl = dlText(t.deadline);
      const done = t.subtasks.filter(s => s.completed).length;
      const tot = t.subtasks.length;
      const pct = tot ? Math.round(done / tot * 100) : 0;
      
      return `<div class="tcard${selectedTaskId === t.id ? ' selected' : ''}" data-id="${t.id}" data-idx="${idx}" draggable="${sortMode === 'manual' ? 'true' : 'false'}">
        ${sortMode === 'manual' ? '<span class="tcard-drag" title="拖拽排序">&#8942;&#8942;</span>' : ''}
        <div class="tcard-top"><span class="tcard-q ${getQClass(t.eisenhowerQuadrant)}"></span><span class="tcard-title">${esc(t.title)}</span></div>
        <div class="tcard-meta"><span class="tcard-dl ${dl.cls}">${dl.text}</span>${tot ? `<span class="tcard-progress"><span class="progress-bar"><span class="progress-fill" style="width:${pct}%"></span></span>${done}/${tot}</span>` : ''}</div>
      </div>`;
    }).join('');
    list.innerHTML = html;
    
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

  renderSidebarCompleted();

  // 统计数据
  const allActive = tasks.filter(t => t.status === 'active');
  const completed = tasks.filter(t => t.status === 'completed');
  const todayStr = fmtDate(new Date());
  let todayCount = 0;
  allActive.forEach(t => { 
    if (t.assignedDays && t.assignedDays[todayStr]) todayCount++; 
  });
  document.getElementById('sidebarStats').innerHTML =
  `<span>共 ${allActive.length} 个任务</span><span>今日 ${todayCount} 项</span><span>已完成 ${completed.length}</span>`;

  // 更新筛选按钮状态
  const filterBtn = document.getElementById('filterBtn');
  filterBtn.classList.toggle('active', !!activeFilter);
  filterBtn.querySelector('span').textContent = activeFilter ? Q_SHORT[activeFilter] : '筛选';
}

/** 对任务列表进行排序 */
function sortTaskList(list) {
  const sorted = [...list];
  switch (sortMode) {
    case 'deadline':
      sorted.sort((a, b) => {
        // deadline 键可能不存在，放在最后；如果都不存在则视为相等
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

/** 渲染已完成任务 */
function renderSidebarCompleted() {
  const completed = tasks.filter(t => t.status === 'completed');
  document.getElementById('sidebarCompCount').textContent = completed.length;
  const list = document.getElementById('sidebarCompList');
  if (!completed.length) {
    list.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--text-4)">暂无已完成任务</div>';
    return;
  }
  // 渲染已完成任务列表，显示前20条，并添加恢复和删除按钮
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

  list.querySelectorAll('.comp-restore-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      restoreTask(btn.dataset.id);
    });
  });
  
  // 删除按钮事件监听，添加二次确认
  list.querySelectorAll('.comp-del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      showConfirm('删除任务', '确认要删除此任务吗？', () => {
        tasks = tasks.filter(x => x.id !== id);
        saveTasks(tasks);
        renderAll();
        toast('Deleted');
      });
    });
  });
}

// ======== Sidebar Drag Reorder ========
/** 处理侧边栏拖拽开始 */
function handleSidebarDragStart(e, taskId) {
  sidebarDragId = taskId;
  e.dataTransfer.effectAllowed = 'move';
  e.target.classList.add('dragging');
}

/** 处理侧边栏拖拽经过 */
function handleSidebarDragOver(e, card) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (!sidebarDragId || sidebarDragId === card.dataset.id) return;
  const rect = card.getBoundingClientRect();
  const mid = rect.top + rect.height / 2;
  card.classList.remove('drop-before', 'drop-after');
  card.classList.add(e.clientY < mid ? 'drop-before' : 'drop-after');
}

/** 处理侧边栏拖拽离开 */
function handleSidebarDragLeave(card) {
  card.classList.remove('drop-before', 'drop-after');
}

/** 处理侧边栏拖拽放下 */
function handleSidebarDrop(e, targetId) {
  e.preventDefault();
  if (!sidebarDragId || sidebarDragId === targetId) return;
  
  const card = e.currentTarget;
  const rect = card.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  
  // 根据当前筛选和排序状态获取 active 列表，并找到拖动项和目标项的索引
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
  
  // 更新所有任务的 manualOrder 字段
  active.forEach((t, i) => { t.manualOrder = i; });
  saveTasks(tasks);
  renderSidebar();
  toast('Sort order updated');
}

/** 处理侧边栏拖拽结束 */
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
  else { viewDate.setDate(viewDate.getDate() - 7); }
  renderMainView(); updateNavTitle();
}

function navNext() {
  if (currentView === 'month') { viewDate.setMonth(viewDate.getMonth() + 1); }
  else { viewDate.setDate(viewDate.getDate() + 7); }
  renderMainView(); updateNavTitle();
}

function navToday() { viewDate = new Date(); renderMainView(); updateNavTitle(); }

function updateNavTitle() {
  const el = document.getElementById('navTitle');
  if (currentView === 'month') { el.textContent = viewDate.getFullYear() + '年' + (viewDate.getMonth() + 1) + '月'; }
  else {
    const start = getWeekStart(viewDate);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    el.textContent = (start.getMonth() + 1) + '/' + start.getDate() + ' - ' + (end.getMonth() + 1) + '/' + end.getDate();
  }
}

function renderMainView() {
  if (currentView === 'month') renderMonth();
  else renderWeek();
}

/** 构建日期映射 */
function buildDayMap(activeTasks) {
  const dayMap = {};
  activeTasks.forEach(t => {
    if (!t.assignedDays) return;
    Object.keys(t.assignedDays).forEach(ds => {
      if (!dayMap[ds]) dayMap[ds] = [];
      const dayData = t.assignedDays[ds];
      if (typeof dayData === 'number') {
        dayMap[ds].push({
          task: t,
          sub: { id: '__whole_' + t.id, title: t.title, estimatedHours: dayData },
          slotLabel: ''
        });
      } else if (dayData && dayData.subtaskIds) {
        const slotBySubtaskId = (dayData.slotBySubtaskId && typeof dayData.slotBySubtaskId === 'object')
          ? dayData.slotBySubtaskId
          : {};
        dayData.subtaskIds.forEach(sid => {
          let sub;
          if (sid.startsWith('__whole_')) { sub = { id: sid, title: t.title, estimatedHours: t.estimatedHours || 0 }; }
          else { sub = t.subtasks.find(s => s.id === sid); }
          if (sub) {
            dayMap[ds].push({
              task: t,
              sub,
              slotLabel: String(slotBySubtaskId[sid] || '')
            });
          }
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
    const dayCapacity = getDailyCapacityForDate(ds);
    const over = dayCapacity > 0 ? hrs > dayCapacity : hrs > 0;
    
    html += `<div class="cal-cell${isToday ? ' today' : ''}${over ? ' overloaded' : ''}" data-date="${ds}">
      <div class="cal-date"><span class="cal-date-num${isToday ? ' is-today' : ''}">${d}</span><span class="cal-hours${over ? ' over' : ''}">${hrs > 0 ? hrs + 'h' : ''}</span></div>
      <div class="cal-tasks-mini">${list.slice(0, 3).map(x => {
        const isCompleted = x.sub.completed ? ' completed' : '';
        return `<div class="cal-task-mini${isCompleted}" draggable="true" data-tid="${x.task.id}" data-sid="${x.sub.id}">
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
    const configuredSlotLabels = getConfiguredSlotLabelsForDate(ds);
    let list = dayMap[ds] || [];
    
    // 根据 Eisenhower 象限排序，未指定象限的放在最后
    const qOrder = { 'Q1': 0, 'Q2': 1, 'Q3': 2, 'Q4': 3 };
    list = [...list].sort((a, b) => {
      const qa = qOrder[a.task.eisenhowerQuadrant] ?? 3;
      const qb = qOrder[b.task.eisenhowerQuadrant] ?? 3;
      return qa - qb;
    });
    
    const hrs = list.reduce((s, x) => s + (x.sub.estimatedHours || 0), 0);
    const dayCapacity = getDailyCapacityForDate(ds);
    const over = dayCapacity > 0 ? hrs > dayCapacity : hrs > 0;
    const slotHeader = configuredSlotLabels.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin-top:4px;">
          ${configuredSlotLabels.map(label => `<span style="font-size:10px;line-height:1;padding:2px 6px;border-radius:10px;background:var(--bg-3);color:var(--text-3);">${esc(label)}</span>`).join('')}
        </div>`
      : '';

    html += `<div class="week-col" data-date="${ds}">
      <div class="week-col-header">
        <div class="wdate${isToday ? ' is-today' : ''}">${d.getDate()}</div>
        <div class="wday">${WEEKDAYS[d.getDay()]}</div>
        <div class="whours${over ? ' over' : ''}">${hrs}h / ${dayCapacity}h</div>
        ${slotHeader}
      </div>
      <div class="week-col-body" data-date="${ds}">
        ${list.length ? list.map(x => {
          const isCompleted = x.sub.completed ? ' completed' : '';
          const slotLabel = String(x.slotLabel || '').trim() || (configuredSlotLabels.length === 1 ? configuredSlotLabels[0] : '');
          const slotBadge = slotLabel
            ? `<span style="display:inline-block;font-size:10px;line-height:1;padding:2px 6px;border-radius:10px;background:var(--bg-3);color:var(--text-3);margin-right:6px;">${esc(slotLabel)}</span>`
            : '';
          return `<div class="week-task ${getQClass(x.task.eisenhowerQuadrant)}${isCompleted}" draggable="true" data-sid="${x.sub.id}" data-tid="${x.task.id}">
          <div class="week-task-title">${esc(x.sub.title)}</div>
          <div class="week-task-parent">${esc(x.task.title)}</div>
          <div class="week-task-hours">${slotBadge}${formatDuration(x.sub.estimatedHours)} <span class="week-task-rm" data-sid="${x.sub.id}" data-tid="${x.task.id}" data-date="${ds}">&#10005;</span></div>
        </div>`;
        }).join('') : '<div class="week-empty">暂无任务</div>'}
      </div>
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
  
  // 
  bindCalendarDragEvents();
  
  bindWeekTaskDrag();
}

/** 绑定日历拖拽事件 */
function bindCalendarDragEvents() {
  // 绑定拖拽开始事件
  document.querySelectorAll('.cal-task-mini[draggable], .week-task[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => {
      draggedTaskId = el.dataset.tid;
      draggedSubtaskId = el.dataset.sid;
      e.dataTransfer.effectAllowed = 'move';
      el.style.opacity = '0.5';
    });
    el.addEventListener('dragend', () => { el.style.opacity = ''; });
  });
  
  // 绑定拖拽目标事件
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
  
  // 绑定移除按钮事件
  document.querySelectorAll('.week-task-rm').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      removeFromCalendar(btn.dataset.tid, btn.dataset.sid, btn.dataset.date);
    });
  });
}

/** 绑定周视图内部拖拽事件 */
function bindWeekTaskDrag() {
  const cols = document.querySelectorAll('.week-col-body');
  cols.forEach(col => {
    const date = col.dataset.date;
    const taskEls = col.querySelectorAll('.week-task');
    
    taskEls.forEach(taskEl => {
      taskEl.addEventListener('dragover', e => {
        e.preventDefault();
        if (!draggedTaskId || !draggedSubtaskId) return;
        
        //  确保拖动的任务/子任务属于当前日期的某个任务
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

/** 处理日历上的拖放事件，将任务/子任务分配到目标日期 */
function handleCalendarDrop(targetDate) {
  if (!draggedTaskId || !draggedSubtaskId) return;
  
  const task = tasks.find(t => t.id === draggedTaskId);
  if (!task) return;
  
  // 获取被拖动的子任务对象，如果是整个任务则构造一个临时对象
  let subtask;
  if (draggedSubtaskId.startsWith('__whole_')) {
    subtask = { id: draggedSubtaskId, title: task.title, estimatedHours: task.estimatedHours || 1 };
  } else {
    subtask = task.subtasks.find(s => s.id === draggedSubtaskId);
  }
  if (!subtask) return;
  
  // 从原日期移除任务/子任务的分配
  if (task.assignedDays) {
    Object.keys(task.assignedDays).forEach(ds => {
      const dayData = task.assignedDays[ds];
      if (typeof dayData === 'number' && draggedSubtaskId.startsWith('__whole_')) {
        // 整个任务格式，移除后直接删除日期分配
        delete task.assignedDays[ds];
      } else if (typeof dayData === 'object' && dayData.subtaskIds) {
        const idx = dayData.subtaskIds.indexOf(draggedSubtaskId);
        if (idx > -1) {
          dayData.subtaskIds.splice(idx, 1);
          dayData.hours -= subtask.estimatedHours;
          if (dayData.slotBySubtaskId && typeof dayData.slotBySubtaskId === 'object') {
            delete dayData.slotBySubtaskId[draggedSubtaskId];
          }
          if (dayData.hours <= 0 || dayData.subtaskIds.length === 0) {
            delete task.assignedDays[ds];
          }
        }
      }
    });
  }
  
  // 确保目标日期有分配对象
  if (!task.assignedDays) task.assignedDays = {};
  if (!task.assignedDays[targetDate]) {
    task.assignedDays[targetDate] = { subtaskIds: [], hours: 0, slotBySubtaskId: {} };
  }
  let targetDay = task.assignedDays[targetDate];
  
  // 如果目标日期是以数字形式存在（旧格式），则转换为对象格式
  if (typeof targetDay === 'number') {
    task.assignedDays[targetDate] = {
      subtaskIds: ['__whole_' + task.id],
      hours: targetDay,
      slotBySubtaskId: {}
    };
    targetDay = task.assignedDays[targetDate];
  }
  if (!targetDay.slotBySubtaskId || typeof targetDay.slotBySubtaskId !== 'object') {
    targetDay.slotBySubtaskId = {};
  }
  
  if (!targetDay.subtaskIds.includes(draggedSubtaskId)) {
    targetDay.subtaskIds.push(draggedSubtaskId);
    targetDay.hours += subtask.estimatedHours;
  }
  const movedSlotLabel = getDefaultSlotLabelForDate(targetDate);
  if (movedSlotLabel) {
    targetDay.slotBySubtaskId[draggedSubtaskId] = movedSlotLabel;
  } else {
    delete targetDay.slotBySubtaskId[draggedSubtaskId];
  }
  
  // 如果是拖动子任务，则标记为手动分配并记录分配日期
  if (subtask.id && !subtask.id.startsWith('__whole_')) {
    subtask._manuallyAssigned = true;
    subtask._assignedDate = targetDate;
  }
  
  // 如果是拖动整个任务，则更新截止日期
  if (draggedSubtaskId.startsWith('__whole_')) {
    task.deadline = targetDate;
  }
  
  saveTasks(tasks);
  renderAll();
  toast('Moved to ' + targetDate);
  
  draggedTaskId = null;
  draggedSubtaskId = null;
}

/** 从日历中移除任务/子任务的分配 */
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
      if (dayData.slotBySubtaskId && typeof dayData.slotBySubtaskId === 'object') {
        delete dayData.slotBySubtaskId[sid];
      }
      if (sub) dayData.hours -= sub.estimatedHours;
      if (dayData.subtaskIds.length === 0 || dayData.hours <= 0) {
        delete task.assignedDays[date];
      }
    }
  }
  
  saveTasks(tasks);
  renderAll();
  toast('Removed from calendar');
}

// ======== Right Panel ========
/** 渲染右侧统计面板 */
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

  // 绑定象限筛选事件
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
  
  // 统计本周完成的任务数
  const weekStart = getWeekStart(new Date());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
  const weekCompleted = completed.filter(t => {
    if (!t.completedAt) return false;
    const d = new Date(t.completedAt);
    return d >= weekStart && d < weekEnd;
  }).length;
  
  document.getElementById('weekStats').innerHTML = `
    <div class="stat-row"><span class="stat-label">本周任务</span><span class="stat-val">${weekTasks}</span></div>
    <div class="stat-row"><span class="stat-label">预计用时</span><span class="stat-val">${weekHours}h</span></div>
    <div class="stat-row"><span class="stat-label">每日平均</span><span class="stat-val">${(weekHours / 7).toFixed(1)}h</span></div>
    <div class="stat-row"><span class="stat-label">本周完成</span><span class="stat-val" style="color:var(--success)">${weekCompleted}</span></div>
  `;
}

// ======== Sidebar Completed Toggle ========
function toggleSidebarCompleted() {
  const list = document.getElementById('sidebarCompList');
  const arrow = document.getElementById('sidebarCompArrow');
  list.classList.toggle('open');
  arrow.classList.toggle('open');
}

// ======== Chunk & Format Utilities ========

function roundToQuarter(hours) {
  const v = Math.round(hours / 0.25) * 0.25;
  return Math.max(0.25, v);
}
/** 将小时数格式化为字符串，1.5h 显示为 "1.5h"，0.5h 显示为 "30分钟" */

function formatDuration(hours) {
  const h = Number(hours);
  if (isNaN(h) || h <= 0) return '';
  if (h >= 1) {
    return Number.isInteger(h) ? `${h}h` : `${parseFloat(h.toFixed(1))}h`;
  }
  return `${Math.round(h * 60)}分钟`;
}

/** 从标题中去除类似 "(1/3)" 的会话后缀，返回纯标题 */
function stripSessionSuffix(title) {
  return title.replace(/\s*\(?\d+\/\d+\)?\s*$/, '').trim();
}

/** 根据任务标题生成一个适合的 mini start 提示语 */
function genMiniStart(title) {
  if (/code|develop|implement|fix|bug|program/i.test(title)) {
    return 'Open the project and make one small change first.';
  }
  if (/read|study|review|paper|article/i.test(title)) {
    return 'Open materials, scan the outline, and write 3 questions.';
  }
  if (/write|draft|document|report|summary/i.test(title)) {
    return 'Open the doc and write a 3-line outline first.';
  }
  return 'Open related material, write one bullet, then start timer.';
}

/**
  * 将一个时间块（以分钟为单位）分割成多个子块，优先使用 90/45/25 分钟的块，剩余部分如果小于 10 分钟则合并到前一个块中。
  * 返回一个数组，表示分割后的块的分钟数；如果无法分割（即已经是最小块），则返回 null。
  * 例如：
  * splitOnce(120) => [90, 30]
  * splitOnce(100) => [90, 10]
  * splitOnce(80) => [45, 25, 10]
 */
function splitOnce(totalMin) {
  // 小于20分钟的块不再分割，直接返回 null
  if (totalMin < 20) return null;

  // 90分钟以上的块优先分割出90分钟
  if (totalMin >= 90) {
    if (totalMin === 90) {
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

  if (totalMin >= 45) {
    if (totalMin === 45) {
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

  if (totalMin >= 25) {
    if (totalMin === 25) {
      return [15, 10];
    }
    const first = Math.min(25, totalMin);
    const rem = totalMin - first;
    if (rem >= 10) {
      return [first, rem];
    }
    if (rem > 0 && rem < 10) {
      return [first + rem]; 
    }
    return null;
  }

  // 20-24min
  if (totalMin >= 20) {
    return [10, totalMin - 10];
  }

  return null;
}

/** 替换任务中分配了某个子任务的日期分配信息，适用于将一个子任务拆分成多个子任务的情况 */
function replaceAssignmentIds(task, oldSid, oldHours, newSubs) {
  if (!task.assignedDays) return;
  const newSids = newSubs.map(s => s.id);
  const newTotalHours = newSubs.reduce((s, x) => s + x.estimatedHours, 0);

  Object.keys(task.assignedDays).forEach(date => {
    let dayData = task.assignedDays[date];

    // 如果是旧格式的数字分配，且正好对应被拆分的子任务，则转换为对象格式并替换为新子任务 ID
    if (typeof dayData === 'number') {
      task.assignedDays[date] = {
        subtaskIds: ['__whole_' + task.id],
        hours: dayData,
        slotBySubtaskId: {}
      };
      dayData = task.assignedDays[date];
    }

    if (!dayData.subtaskIds) return;
    const idx = dayData.subtaskIds.indexOf(oldSid);
    if (idx === -1) return;
    if (!dayData.slotBySubtaskId || typeof dayData.slotBySubtaskId !== 'object') {
      dayData.slotBySubtaskId = {};
    }
    const oldSlotLabel = String(dayData.slotBySubtaskId[oldSid] || '').trim();
    delete dayData.slotBySubtaskId[oldSid];

    dayData.subtaskIds.splice(idx, 1, ...newSids);
    if (oldSlotLabel) {
      newSids.forEach(newSid => {
        dayData.slotBySubtaskId[newSid] = oldSlotLabel;
      });
    }
    dayData.hours = Math.max(0, (dayData.hours || 0) - oldHours + newTotalHours);

    if (dayData.subtaskIds.length === 0 || dayData.hours <= 0) {
      delete task.assignedDays[date];
    }
  });
}

/** 将一个子任务拆分成多个子任务，并更新相关的日期分配信息，适用于 "Chunk into Sessions" 功能 */
function chunkSubtaskIntoSessions(taskId, subId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  const subIdx = task.subtasks.findIndex(s => s.id === subId);
  if (subIdx === -1) return;
  const oldSub = task.subtasks[subIdx];
  const oldHours = oldSub.estimatedHours || 0;

  const totalMin = Math.round(oldHours * 60);
  if (totalMin < 20) {
    toast('Chunk already minimal');
    return;
  }

  const chunks = splitOnce(totalMin);
  if (!chunks || chunks.length <= 1) {
    toast('Chunk already minimal');
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
  toast(`Split into ${n} sessions`);
}

// ======== Task Selection & Detail (Inline Editing) ========
function selectTask(id) {
  selectedTaskId = id;
  renderSidebar();
  showTaskDetail(id);
}

/** 显示任务详情面板（包含内联编辑 + 分块 + 自动分配） */
function showTaskDetail(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  
  // 内联编辑标题
  const titleInput = document.getElementById('detailTitleInput');
  titleInput.value = t.title;
  titleInput.onchange = () => {
    const newTitle = titleInput.value.trim();
    if (newTitle && newTitle !== t.title) {
      t.title = newTitle;
      saveTasks(tasks);
      renderSidebar();
      renderMainView();
      toast('Title updated');
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
      <h4>基本详情</h4>
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
        <textarea class="detail-notes-area" id="detailNotes" placeholder="可选备注..">${esc(t.notes || '')}</textarea>
      </div>
    </div>
    
    <div class="detail-actions-row">
      <button class="dbtn dbtn-primary" id="detailComplete">${t.status === 'completed' ? '标记为未完成' : '标记为完成'}</button>
      <button class="dbtn dbtn-accent" id="detailAutoAssign">自动分配</button>
      <button class="dbtn dbtn-danger" id="detailDelete">删除</button>
    </div>
    
    <div class="detail-section">
      <h4>子任务(${done}/${tot})</h4>
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
          ${(s.estimatedHours >= 0.5 && !s.completed) ? `<button class="sub-chunk-btn" data-tid="${t.id}" data-sid="${s.id}">拆分</button>` : ''}
          <span class="sub-rm" data-tid="${t.id}" data-sid="${s.id}">&#10005;</span>
        </li>`).join('')}
      </ul>
      <div class="sub-add-row">
        <input type="text" id="newSubTitle" placeholder="新建子任务">
        <input type="number" id="newSubHours" placeholder="小时" min="0.5" step="0.5" value="1">
        <button class="sub-add-btn" id="addSubBtn">添加</button>
      </div>
    </div>
    
    <div class="detail-split-section">
      <div class="detail-split-header">
        <h4>智能拆分</h4>
        <button class="dbtn" style="font-size:11px;padding:3px 10px" id="detailAISplitBtn">AI 拆分</button>
      </div>
      <div class="fg" style="margin-bottom:8px"><label style="font-size:11px">总预计时间(小时)</label><input type="number" id="detailSplitHours" min="0.5" step="0.5" value="${totalHours(t) || 8}" style="width:80px;padding:4px 8px;border:1px solid var(--border-0);border-radius:4px;font-size:12px;background:var(--bg-4);color:var(--text-1)"></div>
      <div id="detailSplitItems"></div>
      <div id="detailSplitTotal" style="font-size:11px;color:var(--text-3);text-align:right;margin-top:4px"></div>
      <button class="dbtn" style="margin-top:4px;font-size:11px" id="detailAddSplitItem">+ 添加子任务</button>
      <div class="split-confirm-bar" id="splitConfirmBar" style="display:none">
        <button class="dbtn" id="splitCancelBtn">取消</button>
        <button class="dbtn dbtn-primary" id="splitApplyBtn">确认拆分</button>
      </div>
    </div>
  `;
  
  // 显示面板
  document.getElementById('detailMask').classList.add('open');
  document.getElementById('detailPanel').classList.add('open');
  
  // 截止日期
  document.getElementById('detailDeadline').onchange = (e) => {
    t.deadline = e.target.value || null;
    t.eisenhowerQuadrant = calcQuadrant(t);
    saveTasks(tasks);
    renderSidebar();
    renderMainView();
    renderPanel();
    showTaskDetail(id); // 刷新详情
    toast('Deadline updated');
  };
  
  // 重要性/紧急性
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
    // 更新象限徽章
    const badge = document.querySelector('.detail-badge.' + getQClass(t.eisenhowerQuadrant));
    if (badge) badge.textContent = Q_LABELS[t.eisenhowerQuadrant];
    toast('Importance updated');
  };
  urgSlider.onchange = () => {
    t.urgency = parseInt(urgSlider.value);
    t.eisenhowerQuadrant = calcQuadrant(t);
    saveTasks(tasks);
    renderSidebar();
    renderPanel();
    toast('Urgency updated');
  };
  
  // 备注
  document.getElementById('detailNotes').onchange = (e) => {
    t.notes = e.target.value.trim();
    saveTasks(tasks);
  };
  
  // 完成/恢复任务
  document.getElementById('detailComplete').onclick = () => {
    if (t.status === 'completed') {
      restoreTask(id);
    } else {
      completeTask(id);
    }
  };
  
  // 自动分配
  document.getElementById('detailAutoAssign').onclick = () => {
    autoAssignSingleTask(t);
    saveTasks(tasks);
    renderAll();
    showTaskDetail(id);
    toast('Auto assignment completed for this task');
  };
  
  // 删除任务
  document.getElementById('detailDelete').onclick = () => { closeDetail(); deleteTask(id); };
  
  // 添加子任务
  document.getElementById('addSubBtn').onclick = () => addSubtask(id);
  
  // 子任务checkbox
  document.querySelectorAll('.sub-check').forEach(cb => {
    cb.onchange = (e) => toggleSubtask(e.target.dataset.tid, e.target.dataset.sid, e.target.checked);
  });
  
  // 子任务删除按钮
  document.querySelectorAll('.sub-rm').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); removeSubtask(btn.dataset.tid, btn.dataset.sid); };
  });
  
  // 子任务拆分按钮
  document.querySelectorAll('.sub-chunk-btn').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); chunkSubtaskIntoSessions(btn.dataset.tid, btn.dataset.sid); };
  });
  
  // 子任务拖拽
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

/** 子任务列表拖拽设置 */
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
const TASK_TYPE_CONFIG = [
  {
    id: 'paper',
    priority: 10,
    matchers: ['\u8BBA\u6587', /paper/i, /essay/i],
    subtasks: [
      { title: '\u6587\u732E\u7EFC\u8FF0', weight: 0.3 },
      { title: '\u64B0\u5199\u521D\u7A3F', weight: 0.35 },
      { title: '\u4FEE\u6539\u5B8C\u5584', weight: 0.2 },
      { title: '\u683C\u5F0F\u6392\u7248', weight: 0.15 }
    ]
  },
  {
    id: 'study',
    priority: 20,
    matchers: ['\u5B66\u4E60', '\u590D\u4E60', '\u5907\u8003', '\u5237\u9898'],
    subtasks: [
      { title: '\u9884\u4E60\u6982\u89C8', weight: 0.2 },
      { title: '\u6DF1\u5EA6\u5B66\u4E60', weight: 0.4 },
      { title: '\u7EC3\u4E60\u5DE9\u56FA', weight: 0.25 },
      { title: '\u603B\u7ED3\u590D\u4E60', weight: 0.15 }
    ]
  },
  {
    id: 'project',
    priority: 30,
    matchers: ['\u9879\u76EE', '\u5F00\u53D1', /demo/i, '\u7CFB\u7EDF'],
    subtasks: [
      { title: '\u9700\u6C42\u5206\u6790', weight: 0.2 },
      { title: '\u65B9\u6848\u8BBE\u8BA1', weight: 0.25 },
      { title: '\u5F00\u53D1\u5B9E\u73B0', weight: 0.4 },
      { title: '\u6D4B\u8BD5\u90E8\u7F72', weight: 0.15 }
    ]
  },
  {
    id: 'default',
    priority: 999,
    matchers: [],
    subtasks: [
      { title: '\u9636\u6BB5 1', weight: 0.35 },
      { title: '\u9636\u6BB5 2', weight: 0.3 },
      { title: '\u9636\u6BB5 3', weight: 0.2 },
      { title: '\u9636\u6BB5 4', weight: 0.15 }
    ]
  }
];

function getSplitTargetHours(task, totalHoursOverride = null) {
  const override = Number(totalHoursOverride);
  if (Number.isFinite(override) && override > 0) return override;
  const safeTask = task || {};
  const base = Number(totalHours(safeTask)) || Number(safeTask.estimatedHours) || 8;
  return base > 0 ? base : 8;
}

function matchesTaskType(title, matcher) {
  if (typeof matcher === 'string') {
    return title.toLowerCase().includes(matcher.toLowerCase());
  }
  if (matcher instanceof RegExp) {
    const safeFlags = matcher.flags.replace(/g/g, '');
    return new RegExp(matcher.source, safeFlags).test(title);
  }
  return false;
}

function detectTaskType(title, config = TASK_TYPE_CONFIG) {
  if (!Array.isArray(config) || !config.length) return TASK_TYPE_CONFIG[TASK_TYPE_CONFIG.length - 1];
  const safeTitle = String(title || '').trim();
  const sorted = [...config].sort((a, b) => (Number(a?.priority) || 0) - (Number(b?.priority) || 0));
  const defaultType =
    sorted.find(type => type?.id === 'default') ||
    sorted[sorted.length - 1] ||
    TASK_TYPE_CONFIG[TASK_TYPE_CONFIG.length - 1];

  for (const type of sorted) {
    if (!type || type.id === defaultType.id) continue;
    if (typeof type.matcherFn === 'function') {
      try {
        if (type.matcherFn(safeTitle, type)) return type;
      } catch (_) {}
    }
    const matchers = Array.isArray(type.matchers) ? type.matchers : [];
    if (matchers.some(matcher => matchesTaskType(safeTitle, matcher))) return type;
  }
  return defaultType;
}

function allocateHoursByWeights(totalHours, templateSubtasks) {
  const totalUnits = Math.round(Number(totalHours) * 2);
  const source = Array.isArray(templateSubtasks) ? templateSubtasks : [];
  const normalized = source
    .map(item => ({
      title: String(item?.title || '').trim(),
      weight: Number(item?.weight)
    }))
    .filter(item => item.title);

  if (!normalized.length || totalUnits <= 0) return [];

  const keepCount = Math.min(normalized.length, totalUnits);
  const kept = normalized.slice(0, keepCount);
  const units = new Array(keepCount).fill(1);
  const remainingUnits = totalUnits - keepCount;

  if (remainingUnits > 0) {
    let weights = kept.map(item => (Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 0));
    if (weights.every(weight => weight <= 0)) {
      weights = new Array(keepCount).fill(1);
    }
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const rawUnits = weights.map(weight => (weight / weightSum) * remainingUnits);
    const extraUnits = rawUnits.map(value => Math.floor(value));
    let unallocated = remainingUnits - extraUnits.reduce((sum, value) => sum + value, 0);
    const remainders = rawUnits
      .map((value, idx) => ({ idx, remainder: value - Math.floor(value) }))
      .sort((a, b) => (b.remainder - a.remainder) || (a.idx - b.idx));

    let pointer = 0;
    while (unallocated > 0 && remainders.length > 0) {
      const idx = remainders[pointer % remainders.length].idx;
      extraUnits[idx] += 1;
      unallocated -= 1;
      pointer += 1;
    }

    for (let i = 0; i < keepCount; i++) {
      units[i] += extraUnits[i];
    }
  }

  return kept.map((item, idx) => ({
    title: item.title,
    estimatedHours: units[idx] / 2
  }));
}

function isValidAISubtasks(subtasks, totalHours) {
  const targetHours = Number(totalHours);
  if (!Array.isArray(subtasks) || subtasks.length < 2) return false;
  if (!Number.isFinite(targetHours) || targetHours <= 0) return false;

  let aiTotal = 0;
  for (const sub of subtasks) {
    const title = String(sub?.title || '').trim();
    const estimated = Number(sub?.estimatedHours);
    if (!title) return false;
    if (!Number.isFinite(estimated) || estimated <= 0) return false;
    aiTotal += estimated;
  }

  const ratioDiff = Math.abs(aiTotal - targetHours) / targetHours;
  return ratioDiff <= 0.4;
}

function normalizeAISubtasksByTaskType(task, subtasks, totalHours) {
  const targetHours = getSplitTargetHours(task, totalHours);
  if (!isValidAISubtasks(subtasks, targetHours)) {
    return getTemplateSplit(task, targetHours);
  }

  const normalized = subtasks.map(sub => ({
    title: String(sub.title || '').trim(),
    estimatedHours: Number(sub.estimatedHours)
  }));
  const aiTotal = normalized.reduce((sum, sub) => sum + sub.estimatedHours, 0);
  if (Math.abs(aiTotal - targetHours) <= 1e-6) return normalized;

  const proportionalSubtasks = normalized.map(sub => ({
    title: sub.title,
    weight: sub.estimatedHours
  }));
  return allocateHoursByWeights(targetHours, proportionalSubtasks);
}
/** AI智能拆分，将任务拆分为多个子任务 */
async function doAISplit(id) {
  const t = tasks.find(x => x.id === id);
  const btn = document.getElementById('detailAISplitBtn');
  const originalText = btn.textContent;
  btn.textContent = 'AI拆分中...';
  btn.disabled = true;
  const targetHours = getSplitTargetHours(
    t,
    parseFloat(document.getElementById('detailSplitHours')?.value)
  );
  
  try {
    const result = await parseTaskWithAI(t.title);
    if (result && result.subtasks && result.subtasks.length > 0) {
      const adjustedSubtasks = adjustSubtasksForEstimate(result.subtasks);
      const aiValid = isValidAISubtasks(adjustedSubtasks, targetHours);
      const normalizedSubtasks = normalizeAISubtasksByTaskType(t, adjustedSubtasks, targetHours);
      showSplitPreview(normalizedSubtasks);
      toast(
        aiValid ? 'AI split completed, please review and apply' : 'AI split quality is low, using template',
        aiValid ? 'success' : 'info'
      );
    } else {
      showSplitPreview(getTemplateSplit(t, targetHours));
      toast('AI returned no split result, using template', 'info');
    }
  } catch (err) {
    console.error('AI 拆分失败:', err);
    showSplitPreview(getTemplateSplit(t, targetHours));
    toast('AI split failed, using template', 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

/** 获取模板拆分建议 */
function getTemplateSplit(t, totalHoursOverride = null) {
  const taskType = detectTaskType(t?.title, TASK_TYPE_CONFIG);
  const total = getSplitTargetHours(t, totalHoursOverride);
  return allocateHoursByWeights(total, taskType.subtasks || []);
}

/** 显示拆分预览 */
function showSplitPreview(subtasks) {
  const container = document.getElementById('detailSplitItems');
  container.innerHTML = subtasks.map((sub, i) => `
    <div class="split-item">
      <input type="text" value="${esc(sub.title)}" class="split-title-input">
      <input type="number" value="${sub.estimatedHours || 2}" min="0.5" step="0.5" class="split-hours-input">
      <span class="split-rm" style="cursor:pointer;color:var(--text-4)">&#10005;</span>
    </div>
  `).join('');
  
  // 绑定删除事件
  container.querySelectorAll('.split-rm').forEach(rm => {
    rm.onclick = () => { rm.parentElement.remove(); updateDetailSplitTotal(); };
  });
  
  // 绑定小时数变化事件
  container.querySelectorAll('.split-hours-input').forEach(inp => {
    inp.oninput = () => updateDetailSplitTotal();
  });
  
  updateDetailSplitTotal();
  
  // 显示确认按钮
  document.getElementById('splitConfirmBar').style.display = 'flex';
}

/** 在详情面板添加新的子任务 */
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

/** 更新详情面板拆分总时长 */
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
  toast('Split applied');
  
  // 如果设置了拆分后自动分配，则立即进行自动分配
  if (settings.autoAssignAfterSplit && subs.length > 0) {
    setTimeout(() => {
      autoAssignSingleTask(t);
      saveTasks(tasks);
      renderAll();
      toast('Auto assignment completed');
    }, 300);
  }
  
  // 关闭拆分预览
  showTaskDetail(id);
}

// ======== Task CRUD ========
function openTaskModal(id = null) {
  const modal = document.getElementById('taskModal');
  const title = document.getElementById('taskModalTitle');
  
  if (id) {
    const t = tasks.find(x => x.id === id);
    title.textContent = '编辑任务';
    document.getElementById('editId').value = id;
    document.getElementById('fTitle').value = t.title;
    document.getElementById('fDeadline').value = t.deadline || '';
    document.getElementById('fImportance').value = t.importance || 3;
    document.getElementById('fUrgency').value = t.urgency || 3;
    document.getElementById('fNotes').value = t.notes || '';
  } else {
    title.textContent = '新建任务';
    document.getElementById('editId').value = '';
    document.getElementById('fTitle').value = '';
    document.getElementById('fDeadline').value = fmtDate(new Date(Date.now() + 7 * 864e5));
    document.getElementById('fImportance').value = 3;
    document.getElementById('fUrgency').value = 3;
    document.getElementById('fNotes').value = '';
  }
  
  updateSliderDisplay();
  modal.classList.add('open');
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
  
  if (!title) { toast('Please enter a title', 'error'); return; }
  
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
  toast(id ? 'Task updated' : 'Task created');
}

function completeTask(id) {
  const t = tasks.find(x => x.id === id);
  if (t) {
    t.status = 'completed';
    t.completedAt = new Date().toISOString();
    saveTasks(tasks);
    closeDetail();
    renderAll();
    toast('Task completed');
  }
}

function deleteTask(id) {
  showConfirm('删除任务', '确认删除此任务吗？', () => {
    tasks = tasks.filter(x => x.id !== id);
    saveTasks(tasks);
    selectedTaskId = null;
    renderAll();
    toast('Task deleted');
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
    toast('Task restored');
  }
}

// ======== Subtasks ========
// function toggleSubtask(tid, sid, completed) {
//   const t = tasks.find(x => x.id === tid);
//   const s = t.subtasks.find(x => x.id === sid);
//   if (s) {
//     s.completed = completed;

//     //
//     if (completed && s.actualMin == null) {
//       const raw = prompt('Actual minutes spent (optional)');
//       if (raw !== null && raw.trim() !== '') {
//         const minutes = parseFloat(raw);
//         if (!isNaN(minutes) && minutes >= 0) {
//           s.actualMin   = minutes;
//           s.actualHours = Math.round(minutes / 60 * 10) / 10; // 淇濈暀 1 浣嶅皬鏁?
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

  // 如果标记为完成且尚未设置实际耗时，则提示输入实际耗时
  if (completed === true && (s.actualMin === null || s.actualMin === undefined)) {
    const raw = prompt('Actual minutes spent (optional)');
    if (raw !== null) {
      const txt = String(raw).trim();
      if (txt !== '') {
        const minutes = parseFloat(txt);
        if (!Number.isNaN(minutes) && minutes >= 0) {
          s.actualMin = minutes;
          s.actualHours = Math.round((minutes / 60) * 10) / 10; // 保留一位小数
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
  // 添加后清空输入框并聚焦，方便连续添加
  setTimeout(() => {
    const input = document.getElementById('newSubTitle');
    if (input) { input.value = ''; input.focus(); }
  }, 50);
}

// ======== Split Modal (kept for backward compatibility) ========
async function openSplitModal(id) {
  splitTargetId = id;
  const t = tasks.find(x => x.id === id);
  const splitTotalInput = document.getElementById('splitTotalHours');
  const initialTotal = getSplitTargetHours(t, totalHours(t) || 8);
  if (splitTotalInput) splitTotalInput.value = initialTotal;
  
  const btn = document.getElementById('detailSplit');
  const originalText = btn ? btn.textContent : '加载中...';// 如果有按钮元素，显示加载状态
  if (btn) btn.textContent = 'AI拆分中...';
  
  try {
    const result = await parseTaskWithAI(t.title);
    const targetHours = getSplitTargetHours(t, parseFloat(splitTotalInput?.value));
    if (result && result.subtasks && result.subtasks.length > 0) {
      const adjustedSubtasks = adjustSubtasksForEstimate(result.subtasks);
      const aiValid = isValidAISubtasks(adjustedSubtasks, targetHours);
      const normalizedSubtasks = normalizeAISubtasksByTaskType(t, adjustedSubtasks, targetHours);
      const splitItems = document.getElementById('splitItems');
      splitItems.innerHTML = normalizedSubtasks.map((sub, i) => `
        <div class="split-item">
          <input type="text" value="${esc(sub.title)}" class="split-title-input">
          <input type="number" value="${sub.estimatedHours || 2}" min="0.5" step="0.5" class="split-hours-input">
          <span class="split-rm" onclick="this.parentElement.remove()">&#10005;</span>
        </div>
      `).join('');
      if (splitTotalInput) splitTotalInput.value = targetHours;
      updateSplitTotal();
      toast(
        aiValid ? 'AI split completed, please review and apply' : 'AI split quality is low, using template',
        aiValid ? 'success' : 'info'
      );
    } else {
      if (splitTotalInput) splitTotalInput.value = targetHours;
      regenerateSplit();
      toast('AI returned no split result, using template', 'info');
    }
  } catch (err) {
    console.error('AI 拆分失败:', err);
    if (splitTotalInput) splitTotalInput.value = getSplitTargetHours(t, parseFloat(splitTotalInput?.value));
    regenerateSplit();
    toast('AI split failed, using template', 'error');
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
  const subs = getTemplateSplit(t, total);
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
  toast('Split applied');
  
  // 如果设置了拆分后自动分配，则立即进行自动分配
  if (settings.autoAssignAfterSplit && subs.length > 0) {
    setTimeout(() => {
      autoAssignSingleTask(t);
      saveTasks(tasks);
      renderAll();
      toast('Auto assignment completed');
    }, 300);
  }
}

// ======== Auto Assign ========
/** 自动分配所有未分配的任务 */
function autoAssign() {
  const active = tasks.filter(t => t.status === 'active');
  if (!active.length) {
    toast('没有可分配的任务', 'info');
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const usedByDate = getUsedHoursByDate(active);
  const capacitySlots = buildAvailableSlots(settings, today, null, usedByDate, 30);

  if (!capacitySlots.length) {
    toast('No available slot for auto assignment', 'warning');
    return;
  }

  const sorted = [...active].sort((a, b) => calcPriority(b) - calcPriority(a));
  const warns = new Set();
  const multiplier = getEstimateMultiplier();

  sorted.forEach(task => {
    const manuallyAssignedSubIds = new Set();
    if (task.assignedDays) {
      Object.entries(task.assignedDays).forEach(([, info]) => {
        if (typeof info === 'object' && info.subtaskIds) {
          info.subtaskIds.forEach(id => manuallyAssignedSubIds.add(id));
        }
      });
    }

    task.subtasks.forEach(sub => {
      if (sub._manuallyAssigned) manuallyAssignedSubIds.add(sub.id);
    });

    let items = task.subtasks.filter(sub => !sub.completed && !manuallyAssignedSubIds.has(sub.id));
    if (!items.length) {
      if (task.subtasks.length === 0 && !hasAnyAssignment(task)) {
        items = [{ id: '__whole_' + task.id, title: task.title, estimatedHours: task.estimatedHours || 1 }];
      } else {
        return;
      }
    }

    items = applyEstimateMultiplierToWholeTaskItems(items, multiplier);
    items = interleaveSubtasksByGroup(items);
    const assignmentDeadline = getAssignmentDeadline(task, today, {});
    if (!task.assignedDays) task.assignedDays = {};

    const slotGroupState = new Map();
    const slotTaskDateState = new Map([
      [task.id, new Set(Object.keys(task.assignedDays || {}))]
    ]);
    items.forEach(sub => {
      const placed = assignSubtaskToCapacitySlots(
        task,
        sub,
        capacitySlots,
        assignmentDeadline,
        slotGroupState,
        slotTaskDateState
      );
      if (!placed) warns.add(task.title);
    });
  });

  saveTasks(tasks);
  renderAll();
  if (warns.size) toast('部分任务可能无法按时完成', 'warning');
  else toast('Tasks auto assigned');
}

function hasAnyAssignment(task) {
  if (!task.assignedDays) return false;
  return Object.keys(task.assignedDays).length > 0;
}

/** 获取任务的分配截止日期，优先使用任务的deadline，如果没有则根据象限和当前日期计算 */
function getAssignmentDeadline(task, today, slots) {
  if (task.deadline) {
    const dl = new Date(task.deadline);
    dl.setHours(0, 0, 0, 0);
    return dl;
  }
  
  // Q1(重要且紧急)的截止日期为本周末，Q3(不重要但紧急)的截止日期为下周末，其他象限的截止日期为两周后
  // 计算本周的开始和结束日期
  const weekStart = getWeekStart(today);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7); // 下周末
  
  // 对于Q1和Q3，截止日期为本周末或下周末
  if (task.eisenhowerQuadrant === 'Q2' || task.eisenhowerQuadrant === 'Q4') {
    // 计算本周末的日期（周六或周日）
    const saturday = new Date(weekStart);
    saturday.setDate(saturday.getDate() + 5);
    const sunday = new Date(weekStart);
    sunday.setDate(sunday.getDate() + 6);
    
    // 如果本周末的slot已经满了，则截止日期为下周末
    return sunday;
  }
  
  // 对于Q1和Q3，截止日期为两周后
  const twoWeeks = new Date(today);
  twoWeeks.setDate(twoWeeks.getDate() + 14);
  return twoWeeks;
}

/** 自动分配单个任务 */
function autoAssignSingleTask(task) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const multiplier = getEstimateMultiplier();

  const manuallyAssignedSubIds = new Set();
  if (task.assignedDays) {
    Object.values(task.assignedDays).forEach(info => {
      if (typeof info === 'object' && info.subtaskIds) {
        info.subtaskIds.forEach(id => manuallyAssignedSubIds.add(id));
      }
    });
  }
  task.subtasks.forEach(sub => {
    if (sub._manuallyAssigned) manuallyAssignedSubIds.add(sub.id);
  });

  let items = task.subtasks.filter(sub => !sub.completed && !manuallyAssignedSubIds.has(sub.id));
  if (!items.length && task.subtasks.length === 0 && !hasAnyAssignment(task)) {
    items = [{ id: '__whole_' + task.id, title: task.title, estimatedHours: task.estimatedHours || 1 }];
  }
  if (!items.length) {
    toast('No subtasks need assignment', 'info');
    return;
  }

  items = applyEstimateMultiplierToWholeTaskItems(items, multiplier);
  items = interleaveSubtasksByGroup(items);
  const assignmentDeadline = getAssignmentDeadline(task, today, {});

  const active = tasks.filter(t => t.status === 'active');
  const usedByDate = getUsedHoursByDate(active);
  const capacitySlots = buildAvailableSlots(settings, today, assignmentDeadline, usedByDate, 30);

  if (!capacitySlots.length) {
    toast('No available slot for auto assignment', 'warning');
    return;
  }

  if (!task.assignedDays) task.assignedDays = {};

  const slotGroupState = new Map();
  const slotTaskDateState = new Map([
    [task.id, new Set(Object.keys(task.assignedDays || {}))]
  ]);
  let hasUnplaced = false;
  items.forEach(sub => {
    const placed = assignSubtaskToCapacitySlots(
      task,
      sub,
      capacitySlots,
      assignmentDeadline,
      slotGroupState,
      slotTaskDateState
    );
    if (!placed) hasUnplaced = true;
  });

  if (hasUnplaced) toast('Some subtasks could not be fully assigned', 'warning');
}

// ======== AI ========
/** 处理AI输入 */
async function handleAI() {
  const input = document.getElementById('aiInput');
  const text = input.value.trim();
  if (!text) return;
  
  const status = document.getElementById('aiStatus');
  status.textContent = '解析中..';
  
  try {
    const result = await parseTaskWithAI(text);
    status.textContent = '';
    const adjustedResult = {
      ...result,
      subtasks: adjustSubtasksForEstimate(result.subtasks || [])
    };
    adjustedResult.estimatedHours =
      adjustedResult.subtasks.reduce((sum, s) => sum + (s.estimatedHours || 0), 0) ||
      result.estimatedHours ||
      0;
    showAIPreview(adjustedResult);
  } catch (e) {
    status.textContent = '';
    toast('AI 解析失败: ' + e.message, 'error');
    const parsed = parseLocal(text);
    if (parsed) {
      const adjustedParsed = {
        ...parsed,
        subtasks: adjustSubtasksForEstimate(parsed.subtasks || [])
      };
      adjustedParsed.estimatedHours =
        adjustedParsed.subtasks.reduce((sum, s) => sum + (s.estimatedHours || 0), 0) ||
        parsed.estimatedHours ||
        0;
      showAIPreview(adjustedParsed);
    }
  }
}

function parseLocal(text) {
  let deadline = null;
  const todayD = new Date();
  const mDays = text.match(/(\d+)\s*(days?|d)/i);
  if (mDays) {
    const d = new Date(todayD);
    d.setDate(d.getDate() + parseInt(mDays[1], 10));
    deadline = fmtDate(d);
  }
  if (/tomorrow/i.test(text)) {
    const d = new Date(todayD);
    d.setDate(d.getDate() + 1);
    deadline = fmtDate(d);
  }
  if (/day after tomorrow/i.test(text)) {
    const d = new Date(todayD);
    d.setDate(d.getDate() + 2);
    deadline = fmtDate(d);
  }
  if (/next week/i.test(text)) {
    const d = new Date(todayD);
    d.setDate(d.getDate() + 7);
    deadline = fmtDate(d);
  }
  const mDate = text.match(/(\d{1,2})[/\-.](\d{1,2})/);
  if (mDate && !deadline) {
    deadline = `${todayD.getFullYear()}-${mDate[1].padStart(2, '0')}-${mDate[2].padStart(2, '0')}`;
  }

  let title = text.trim();
  if (!title) title = 'Untitled task';

  const daysLeft = deadline ? Math.round((new Date(deadline) - todayD) / 864e5) : 7;
  const urgency = daysLeft <= 1 ? 5 : daysLeft <= 3 ? 4 : daysLeft <= 7 ? 3 : daysLeft <= 14 ? 2 : 1;

  return { title, deadline, urgency, importance: 3, estimatedHours: 6, subtasks: [], reasoning: 'Keyword parsing' };
}

/** 显示AI解析结果预览 */
function showAIPreview(data) {
  const el = document.getElementById('aiPreview');
  let subsHtml = data.subtasks && data.subtasks.length ? data.subtasks.map((s, i) => `
    <div class="ai-sub-item" style="display:flex;gap:8px;align-items:center;margin:4px 0;">
      <input type="text" class="ai-sub-title" data-idx="${i}" value="${esc(s.title)}" style="flex:1;background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);font-size:12px;">
      <input type="number" class="ai-sub-hours" data-idx="${i}" value="${s.estimatedHours}" min="0.5" step="0.5" style="width:60px;background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);font-size:12px;">
      <span style="color:var(--text-3);font-size:11px;">h</span>
    </div>
  `).join('') : '<div class="ai-sub-item" style="color:var(--text-4)">没有子任务建议</div>';
  
  el.innerHTML = `<h4>任务解析结果</h4>
    <div class="ai-field"><span class="af-label">标题</span><input type="text" id="aiEditTitle" class="af-val" value="${esc(data.title)}" style="background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);flex:1;"></div>
    <div class="ai-field"><span class="af-label">截止</span><input type="date" id="aiEditDeadline" class="af-val" value="${data.deadline || ''}" style="background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);"></div>
    <div class="ai-field"><span class="af-label">紧急程度</span><input type="number" id="aiEditUrgency" class="af-val" value="${data.urgency}" min="1" max="5" style="width:60px;background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);"></div>
    <div class="ai-field"><span class="af-label">重要性</span><input type="number" id="aiEditImportance" class="af-val" value="${data.importance}" min="1" max="5" style="width:60px;background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);"></div>
    <div class="ai-field"><span class="af-label">预计时间</span><input type="number" id="aiEditHours" class="af-val" value="${data.estimatedHours}" min="0.5" step="0.5" style="width:80px;background:var(--bg-3);border:1px solid var(--border-1);padding:4px 8px;border-radius:4px;color:var(--text-1);"><span style="margin-left:4px;color:var(--text-3);">h</span></div>
    <div class="ai-subs" style="margin:10px 0;padding:8px;background:var(--bg-2);border-radius:6px;">
      <div style="font-size:11px;color:var(--text-3);margin-bottom:6px;">子任务建议（可编辑）</div>
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

/** 从AI解析结果创建任务 */
function createFromAI() {
  const el = document.getElementById('aiPreview');
  const originalData = el._data; if (!originalData) return;
  
  const title = document.getElementById('aiEditTitle').value.trim();
  const deadline = document.getElementById('aiEditDeadline').value || null;
  const urgency = parseInt(document.getElementById('aiEditUrgency').value) || 3;
  const importance = parseInt(document.getElementById('aiEditImportance').value) || 3;
  const estimatedHours = parseFloat(document.getElementById('aiEditHours').value) || 2;
  
  if (!title) { toast('Please enter a title', 'error'); return; }
  
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
  toast('Task created');
  
  // 自动分配（如果有多余的子任务）
  if (settings.autoAssignAfterSplit && subs.length) {
    setTimeout(() => {
      autoAssignSingleTask(t);
      saveTasks(tasks);
      renderAll();
      toast('Auto assignment completed');
    }, 300);
  }
}

// ======== Settings ========
function normalizeWeeklySlotRowsForEditor(slots = []) {
  if (!Array.isArray(slots)) return [];
  return slots.map(slot => {
    let day = Number(slot?.weekday ?? slot?.dayOfWeek);
    if (!Number.isInteger(day) || day < 0 || day > 6) day = 1;

    let startMin = parseTimeToMinutes(String(slot?.start || ''));
    if (startMin == null) startMin = 9 * 60;

    let endMin = parseTimeToMinutes(String(slot?.end || ''));
    if (endMin == null || endMin <= startMin) {
      endMin = Math.min(startMin + 60, 24 * 60);
      if (endMin <= startMin) startMin = Math.max(0, endMin - 60);
    }

    return {
      weekday: day,
      dayOfWeek: day,
      start: minutesToTime(startMin),
      end: minutesToTime(endMin)
    };
  });
}

function renderWeeklySlotEditor(slots = []) {
  const container = document.getElementById('sWeeklySlots');
  const rows = normalizeWeeklySlotRowsForEditor(slots);
  if (!rows.length) {
    container.innerHTML = '<div class="weekly-slots-empty">未设置每周可用时间，将按默认时间分配任务</div>';
    return;
  }

  const dayOptions = WEEKDAY_PICKER.map(day => `<option value="${day.value}">${day.label}</option>`).join('');
  container.innerHTML = rows.map(slot => `
    <div class="weekly-slot-item">
      <select class="slot-day">${dayOptions}</select>
      <input type="time" class="slot-start" value="${slot.start}" step="900">
      <span class="slot-sep">-</span>
      <input type="time" class="slot-end" value="${slot.end}" step="900">
      <span class="slot-rm" role="button" title="删除">&times;</span>
    </div>
  `).join('');

  container.querySelectorAll('.weekly-slot-item').forEach((row, idx) => {
    const select = row.querySelector('.slot-day');
    select.value = String(rows[idx].dayOfWeek);
  });
}

function collectWeeklySlotEditorRows() {
  const rows = Array.from(document.querySelectorAll('#sWeeklySlots .weekly-slot-item'));
  return rows.map(row => ({
    weekday: Number(row.querySelector('.slot-day')?.value),
    dayOfWeek: Number(row.querySelector('.slot-day')?.value),
    start: String(row.querySelector('.slot-start')?.value || ''),
    end: String(row.querySelector('.slot-end')?.value || '')
  }));
}

function validateAndNormalizeWeeklySlotsFromEditor() {
  const rows = collectWeeklySlotEditorRows();
  for (const row of rows) {
    const startMin = parseTimeToMinutes(row.start);
    const endMin = parseTimeToMinutes(row.end);
    if (startMin == null || endMin == null || endMin <= startMin) {
      return null;
    }
  }
  return normalizeWeeklyAvailabilitySlots(rows);
}

function addWeeklySlotRow() {
  const slots = collectWeeklySlotEditorRows();
  const last = slots[slots.length - 1];
  const baseDay = Number(last?.weekday ?? last?.dayOfWeek);
  const nextDay = Number.isInteger(baseDay) && baseDay >= 0 && baseDay <= 6
    ? (baseDay + 2) % 7
    : 1;
  slots.push({
    weekday: nextDay,
    dayOfWeek: nextDay,
    start: String(last?.start || '09:00'),
    end: String(last?.end || '10:00')
  });
  renderWeeklySlotEditor(slots);
}

function openSettings() {
  syncWeeklyAvailabilitySettingsObject(settings);
  document.getElementById('sDailyH').value = settings.dailyWorkHours;
  document.getElementById('sSplitT').value = settings.splitThreshold;
  document.getElementById('sAutoAssign').value = String(settings.autoAssignAfterSplit);
  renderWeeklySlotEditor(settings.weeklyAvailability);
  document.getElementById('settingsModal').classList.add('open');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('open');
}

function saveSettingsHandler() {
  settings.dailyWorkHours = parseFloat(document.getElementById('sDailyH').value) || 4;
  settings.splitThreshold = parseInt(document.getElementById('sSplitT').value) || 6;
  settings.autoAssignAfterSplit = document.getElementById('sAutoAssign').value === 'true';

  const weeklySlots = validateAndNormalizeWeeklySlotsFromEditor();
  if (weeklySlots == null) {
    toast('Please check weekly availability: end time must be after start time', 'error');
    return;
  }
  settings.weeklyAvailability = weeklySlots.map(slot => ({
    weekday: slot.weekday,
    start: slot.start,
    end: slot.end
  }));
  settings.weeklyAvailabilitySlots = weeklySlots.map(slot => ({
    dayOfWeek: slot.dayOfWeek,
    start: slot.start,
    end: slot.end
  }));
  syncWeeklyAvailabilitySettingsObject(settings);

  saveSettings(settings);
  closeSettingsModal();
  renderAll();
  toast('Settings saved');
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
  toast('Data exported');
}

function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = function(ev) {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.tasks && Array.isArray(data.tasks)) {
        showConfirm('Import data', 'This will overwrite current data. Continue?', () => {
          tasks = data.tasks;
          if (data.settings) settings = { ...settings, ...data.settings };
          syncWeeklyAvailabilitySettingsObject(settings);
          saveTasks(tasks);
          saveSettings(settings);
          migrateTasks();
          renderAll();
          toast('Data imported');
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
    const callback = confirmCb;  // ?
    closeConfirm();  // 关闭对话框（会清空confirmCb）
    if (callback) callback();  // 执行保存的回调函数
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

// ======== Event Listeners ========
function setupListeners() {
  // View toggle
  document.getElementById('viewMonth').onclick = () => setView('month');
  document.getElementById('viewWeek').onclick = () => setView('week');
  
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
  document.getElementById('fTitle').addEventListener('keydown', e => {
    const input = e.currentTarget;
    if (e.key === 'Tab' && !e.shiftKey && !input.value.trim()) {
      e.preventDefault();
      input.value = '\u5B8C\u6210\u8BFE\u7A0B\u8BBA\u6587';
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
  
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
  document.getElementById('sAddWeeklySlot').onclick = addWeeklySlotRow;
  document.getElementById('sWeeklySlots').addEventListener('click', e => {
    if (!e.target.classList.contains('slot-rm')) return;
    const slots = collectWeeklySlotEditorRows();
    const index = Array.from(e.currentTarget.querySelectorAll('.slot-rm')).indexOf(e.target);
    if (index < 0) return;
    slots.splice(index, 1);
    renderWeeklySlotEditor(slots);
  });
  
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

function registerQAHooks() {
  if (window.__TT_QA__ !== true) return;

  window.__TT_QA_openLegacySplitModal = async function(taskId) {
    return openSplitModal(taskId);
  };

  window.__TT_QA_regenerateLegacySplit = function(totalHours) {
    const input = document.getElementById('splitTotalHours');
    const value = Number(totalHours);
    if (input && Number.isFinite(value) && value > 0) {
      input.value = value;
    }
    regenerateSplit();
  };
}

// ======== Start ========
init();

