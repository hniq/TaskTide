// Utility functions

const TASKS_KEY = 'ddl_tasks';
const SETTINGS_KEY = 'ddl_settings';
const PROFILE_KEY = 'ddl_user_profile';
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 用户画像：身份角色、使用目的、时间管理挑战 */
const USER_PROFILE_OPTIONS = {
  role: [
    { value: 'student', label: '学生' },
    { value: 'worker', label: '职场人' },
    { value: 'freelancer', label: '自由职业者' },
    { value: 'entrepreneur', label: '创业者' },
    { value: 'parent', label: '家长/家庭' },
    { value: 'other', label: '其他' }
  ],
  purpose: [
    { value: 'study', label: '学习/备考' },
    { value: 'work', label: '工作项目' },
    { value: 'habit', label: '习惯养成' },
    { value: 'life', label: '生活事务' },
    { value: 'balance', label: '多目标平衡' },
    { value: 'other', label: '其他' }
  ],
  challenge: [
    { value: 'procrastination', label: '容易拖延' },
    { value: 'overcommit', label: '任务过多/贪多' },
    { value: 'estimate', label: '时间预估不准' },
    { value: 'focus', label: '难以专注/易被打断' },
    { value: 'priority', label: '分不清轻重缓急' },
    { value: 'none', label: '暂无明显挑战' }
  ]
};

const DEFAULT_PROFILE = {
  role: '',
  purpose: '',
  challenge: '',
  tags: [],
  completed: false
};

/** 输入模板：三组写死模板（小红书高频目标），选中后填入任务输入框 */
const TASK_TEMPLATE_GROUPS = [
  {
    name: '备考学习',
    templates: [
      { label: '考研备考', text: '考研备考：专业课一轮背诵+真题、英语阅读+作文模板、政治肖八肖四，每天学习6小时，目标12月考前完成三轮冲刺，下周开始按科目排周计划' },
      { label: '考公备考', text: '考公备考：行测言语判断资料数量分模块刷题、申论小题+大作文练笔、每周至少2套真题模考，目标省考/国考上岸，2个月内完成系统复习' },
      { label: '四六级/雅思', text: '四六级/雅思：听力精听+阅读限时练+写作模板+口语题库，每天背单词50个、听力30分钟、阅读2篇，考前1个月冲刺刷真题，目标分数达标' },
      { label: '教资/资格证', text: '教资/资格证考试：按考试大纲过教材、整理笔记与思维导图、刷历年真题+错题本、考前背诵简答与材料分析，考前30天集中冲刺' }
    ]
  },
  {
    name: '职场/简历',
    templates: [
      { label: '秋招/春招', text: '秋招春招：每天投递5-10家、笔试刷行测与专业题、每场面试后写复盘与话术优化、建立Offer对比表做决策，本周完成简历定稿和投递目标' },
      { label: '简历优化', text: '简历优化：一页纸精简、用STAR法则写3段项目经历、针对目标岗位做2-3个定制版、找内行改一版，本周完成初稿下周定稿' },
      { label: '跳槽准备', text: '跳槽准备：列出目标公司清单、更新简历与作品集、准备常见面试题与谈薪话术、约内推与猎头，2个月内完成面试并拿到Offer' },
      { label: '转行入门', text: '转行入门：选定目标岗位、拆解JD列学习清单、完成1-2个可展示的项目/作品集、考取相关证书或实战项目，3个月达到可投递水平' }
    ]
  },
  {
    name: '自媒体/生活',
    templates: [
      { label: '小红书起号', text: '小红书起号：定赛道与人设、建选题库50条、统一封面风格与标题公式、拆解10篇爆款写SOP、每周发3篇并看数据优化，1个月涨粉到1000' },
      { label: '短视频/直播', text: '短视频/直播：每周定选题写脚本、拍摄2-3条、剪辑加字幕发布、看完播率与互动做复盘、直播话术与节奏练熟，稳定周更3条+直播2场' },
      { label: '健身减脂', text: '健身减脂：制定3个月目标体重与围度、每周力量训练3次+有氧2次、每日饮食记录与热量控制、每周称重与拍照复盘，下周开始执行第一周计划' },
      { label: '副业/理财', text: '副业/理财：梳理可做的副业方向并选1个试水、坚持记账与月度复盘、学习理财基础并做小额定投/打新、3个月内建立习惯与初步收益' }
    ]
  }
];

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

/** 根据三个维度生成画像标签（用于传给 AI 的简短描述） */
function buildProfileTags(profile) {
  if (!profile || (!profile.role && !profile.purpose && !profile.challenge)) return [];
  const opts = USER_PROFILE_OPTIONS;
  const roleLabel = opts.role.find(r => r.value === profile.role)?.label || '';
  const purposeLabel = opts.purpose.find(p => p.value === profile.purpose)?.label || '';
  const challengeLabel = opts.challenge.find(c => c.value === profile.challenge)?.label || '';
  return [roleLabel, purposeLabel, challengeLabel].filter(Boolean);
}

/**
 * 判断用户输入是否匹配写死模板，便于先带模板再让 LLM 细化拆分
 * @param {string} input - 用户输入的任务描述
 * @returns {{ label: string, fullText: string, groupName: string } | null}
 */
function getTemplateForInput(input) {
  if (!input || typeof input !== 'string') return null;
  const t = input.trim();
  if (!t) return null;
  for (const g of TASK_TEMPLATE_GROUPS) {
    for (const tmpl of g.templates) {
      const same = t === tmpl.text;
      const inputContainsTemplate = t.length >= tmpl.text.length && t.includes(tmpl.text);
      const templateContainsInput = tmpl.text.includes(t) && t.length >= 10;
      if (same || inputContainsTemplate || templateContainsInput) {
        return { label: tmpl.label, fullText: tmpl.text, groupName: g.name };
      }
    }
  }
  return null;
}

export {
  TASKS_KEY, SETTINGS_KEY, PROFILE_KEY, WEEKDAYS, Q_LABELS, Q_SHORT,
  USER_PROFILE_OPTIONS, DEFAULT_PROFILE, buildProfileTags,
  TASK_TEMPLATE_GROUPS, getTemplateForInput,
  DEFAULT_SETTINGS, uid, fmtDate, esc, dlText,
  calcQuadrant, calcPriority, getQClass, totalHours, getWeekStart
};
