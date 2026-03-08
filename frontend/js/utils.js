// Utility functions

const TASKS_KEY = 'ddl_tasks';
const SETTINGS_KEY = 'ddl_settings';
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const Q_LABELS = { Q1: '紧急且重要', Q2: '重要不紧急', Q3: '紧急不重要', Q4: '不紧急不重要' };
const Q_SHORT = { Q1: 'Q1', Q2: 'Q2', Q3: 'Q3', Q4: 'Q4' };

const DEFAULT_SETTINGS = {
  dailyWorkHours: 4,
  splitThreshold: 6,
  autoAssignAfterSplit: true,
  weeklyAvailabilitySlots: [],
  defaultCalendarView: 'month',
  habitMemory: { taskPatterns: [] }
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fmtDate(d) {
  return d.getFullYear() + '-' + 
    String(d.getMonth() + 1).padStart(2, '0') + '-' + 
    String(d.getDate()).padStart(2, '0');
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** 将截止日期转换为人类可读文本，处理null/无效日期 */
function dlText(deadline) {
  if (!deadline) return { text: '无截止日期', cls: 'no-deadline' };
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dl = new Date(deadline);
  dl.setHours(0, 0, 0, 0);
  if (isNaN(dl.getTime())) return { text: '无截止日期', cls: 'no-deadline' };
  const days = Math.round((dl - now) / 864e5);
  if (days < 0) return { text: '逾期' + Math.abs(days) + '天', cls: 'overdue' };
  if (days === 0) return { text: '今天截止', cls: 'overdue' };
  if (days === 1) return { text: '明天截止', cls: 'urgent' };
  if (days <= 3) return { text: days + '天后', cls: 'urgent' };
  return { text: days + '天后', cls: '' };
}

function calcQuadrant(t) {
  const u = t.urgency || 3, i = t.importance || 3;
  if (u >= 3.5 && i >= 3.5) return 'Q1';
  if (u < 3.5 && i >= 3.5) return 'Q2';
  if (u >= 3.5 && i < 3.5) return 'Q3';
  return 'Q4';
}

/** 计算任务动态优先级分数，处理null截止日期 */
function calcPriority(t) {
  if (t.manualPriority != null) return t.manualPriority;
  const base = { Q1: 95, Q2: 75, Q3: 55, Q4: 35 }[t.eisenhowerQuadrant] || 50;
  if (!t.deadline) return base;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dl = new Date(t.deadline);
  dl.setHours(0, 0, 0, 0);
  if (isNaN(dl.getTime())) return base;
  const days = (dl - now) / 864e5;
  const bonus = days < 0 ? 20 : Math.max(0, (7 - days) * 2);
  return Math.min(120, base + bonus);
}

function getQClass(q) {
  return q ? q.toLowerCase() : 'q4';
}

function totalHours(t) {
  if (t.subtasks && t.subtasks.length > 0) {
    return t.subtasks.reduce((s, sub) => s + sub.estimatedHours, 0);
  }
  return t.estimatedHours || 0;
}

function getWeekStart(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

export {
  TASKS_KEY, SETTINGS_KEY, WEEKDAYS, Q_LABELS, Q_SHORT,
  DEFAULT_SETTINGS, uid, fmtDate, esc, dlText,
  calcQuadrant, calcPriority, getQClass, totalHours, getWeekStart
};
