const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:4173/index.html';
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT_DIR = path.resolve(process.cwd(), 'artifacts/estimate-multiplier');

fs.mkdirSync(OUT_DIR, { recursive: true });

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildTask({
  id,
  title,
  status = 'active',
  estimatedHours = null,
  subtasks = [],
  assignedDays = {},
  deadline = null,
  importance = 3,
  urgency = 3,
  quadrant = 'Q2',
  manualOrder = 0
}) {
  return {
    id,
    title,
    deadline,
    estimatedHours,
    importance,
    urgency,
    eisenhowerQuadrant: quadrant,
    status,
    subtasks,
    notes: '',
    manualPriority: null,
    assignedDays,
    manualOrder,
    createdAt: new Date().toISOString(),
    createdBy: 'manual'
  };
}

function historyTask(r1 = { actual: 2, estimated: 1 }, r2 = { actual: 1, estimated: 1 }) {
  return buildTask({
    id: 'hist',
    title: 'history-task',
    status: 'completed',
    estimatedHours: 2,
    subtasks: [
      { id: 'h1', title: 'sample-1', estimatedHours: r1.estimated, actualHours: r1.actual, completed: true, order: 0, actualMin: null, miniStart: '' },
      { id: 'h2', title: 'sample-2', estimatedHours: r2.estimated, actualHours: r2.actual, completed: true, order: 1, actualMin: null, miniStart: '' }
    ],
    assignedDays: {},
    manualOrder: 0
  });
}

const DEFAULT_SETTINGS = {
  dailyWorkHours: 4,
  splitThreshold: 6,
  autoAssignAfterSplit: true,
  defaultCalendarView: 'week',
  habitMemory: { taskPatterns: [] }
};

const results = [];

function record(id, pass, actual, expected, note = '') {
  results.push({ id, pass, actual, expected, note });
}

async function mark(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('__acceptance_mark__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__acceptance_mark__';
      el.style.position = 'fixed';
      el.style.top = '12px';
      el.style.right = '12px';
      el.style.zIndex = '99999';
      el.style.padding = '10px 12px';
      el.style.background = 'rgba(0,0,0,0.75)';
      el.style.color = '#fff';
      el.style.fontSize = '14px';
      el.style.borderRadius = '8px';
      el.style.maxWidth = '40vw';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function shot(page, filename) {
  await page.screenshot({ path: path.join(OUT_DIR, filename), fullPage: true });
}

async function setState(page, tasks, settings = DEFAULT_SETTINGS) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ tasks, settings }) => {
    localStorage.setItem('ddl_tasks', JSON.stringify(tasks));
    localStorage.setItem('ddl_settings', JSON.stringify(settings));
  }, { tasks, settings });
  await page.reload({ waitUntil: 'networkidle' });
}

function approxEqual(a, b, eps = 1e-6) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await setState(page, []);
    const m1 = await page.evaluate(() => window.getEstimateMultiplier());
    record('TC01', approxEqual(m1, 1), m1, 1, 'no history => 1');
    await mark(page, `TC01 multiplier=${m1}`);
    await shot(page, 'tc01-default-multiplier.png');

    await setState(page, [historyTask({ actual: 2, estimated: 1 }, { actual: 1, estimated: 1 })]);
    const m2 = await page.evaluate(() => window.getEstimateMultiplier());
    record('TC02', approxEqual(m2, 1.5), m2, 1.5, 'average ratio');

    await setState(page, [historyTask({ actual: 0.2, estimated: 1 }, { actual: 0.4, estimated: 1 })]);
    const m3 = await page.evaluate(() => window.getEstimateMultiplier());
    record('TC03', approxEqual(m3, 0.7), m3, 0.7, 'clamp min');

    await setState(page, [historyTask({ actual: 3, estimated: 1 }, { actual: 4, estimated: 1 })]);
    const m4 = await page.evaluate(() => window.getEstimateMultiplier());
    record('TC04', approxEqual(m4, 2.5), m4, 2.5, 'clamp max');

    await page.unroute('**/api/parse-task').catch(() => {});
    await page.route('**/api/parse-task', async (route) => {
      const payload = {
        success: true,
        subtasks: [
          { title: 'subtask-A', estimatedHours: 2 },
          { title: 'subtask-B', estimatedHours: 4 }
        ]
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await setState(page, [historyTask({ actual: 2, estimated: 1 }, { actual: 1, estimated: 1 })]);
    await page.fill('#aiInput', 'test ai split');
    await page.click('#aiSendBtn');
    await page.waitForSelector('#aiPreview.open');
    const aiHours = await page.$$eval('.ai-sub-hours', (els) => els.map((el) => Number(el.value)));
    const tc05Pass = aiHours.length >= 2 && approxEqual(aiHours[0], 3) && approxEqual(aiHours[1], 6);
    record('TC05', tc05Pass, aiHours, [3, 6], 'AI subtasks adjusted by multiplier');
    await mark(page, `TC05 AI hours=${aiHours.join(', ')}`);
    await shot(page, 'tc05-ai-adjusted-subtasks.png');
    await page.click('#aiPreviewCancel');

    const wholeTask = buildTask({
      id: 'whole1',
      title: 'whole task',
      estimatedHours: 4,
      subtasks: [],
      assignedDays: {},
      status: 'active',
      manualOrder: 1,
      quadrant: 'Q2'
    });
    await setState(page, [historyTask({ actual: 2, estimated: 1 }, { actual: 1, estimated: 1 }), wholeTask]);
    await page.click('#autoAssignBtn');
    await page.waitForTimeout(500);
    const tc06 = await page.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem('ddl_tasks') || '[]');
      const t = tasks.find((x) => x.id === 'whole1');
      if (!t || !t.assignedDays) return null;
      const entries = Object.values(t.assignedDays);
      if (!entries.length) return null;
      return entries.reduce((sum, info) => {
        const hours = typeof info === 'number' ? info : info.hours;
        return sum + (Number(hours) || 0);
      }, 0);
    });
    record('TC06', approxEqual(tc06, 6), tc06, 6, 'whole task auto assign uses multiplier');
    await mark(page, `TC06 assignedHours=${tc06}`);
    await shot(page, 'tc06-autoassign-whole-task.png');

    const subTask = buildTask({
      id: 'subtask1',
      title: 'subtask task',
      estimatedHours: 2,
      subtasks: [
        { id: 's1', title: 's1', estimatedHours: 2, actualHours: null, completed: false, order: 0, actualMin: null, miniStart: '' }
      ],
      assignedDays: {},
      status: 'active',
      manualOrder: 1,
      quadrant: 'Q2'
    });
    await setState(page, [historyTask({ actual: 2, estimated: 1 }, { actual: 1, estimated: 1 }), subTask]);
    await page.click('#autoAssignBtn');
    await page.waitForTimeout(500);
    const tc07 = await page.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem('ddl_tasks') || '[]');
      const t = tasks.find((x) => x.id === 'subtask1');
      if (!t || !t.assignedDays) return null;
      const entries = Object.values(t.assignedDays);
      if (!entries.length) return null;
      return entries.reduce((sum, info) => {
        const hours = typeof info === 'number' ? info : info.hours;
        return sum + (Number(hours) || 0);
      }, 0);
    });
    record('TC07', approxEqual(tc07, 2), tc07, 2, 'subtasks auto assign unchanged');
    await mark(page, `TC07 assignedHours=${tc07}`);
    await shot(page, 'tc07-autoassign-subtasks.png');

    const today = fmtDate(new Date());
    const tomorrow = fmtDate(new Date(Date.now() + 24 * 3600 * 1000));
    const dragTask = buildTask({
      id: 'drag1',
      title: 'drag task',
      estimatedHours: 2,
      subtasks: [
        { id: 'dsub1', title: 'drag-sub', estimatedHours: 2, actualHours: null, completed: false, order: 0, actualMin: null, miniStart: '' }
      ],
      assignedDays: { [today]: { subtaskIds: ['dsub1'], hours: 2 } },
      status: 'active',
      manualOrder: 1,
      quadrant: 'Q2'
    });
    await setState(page, [historyTask({ actual: 2, estimated: 1 }, { actual: 1, estimated: 1 }), dragTask]);
    await page.click('#viewWeek');
    await page.waitForSelector('.week-task[data-sid=\"dsub1\"]');
    const source = page.locator('.week-task[data-sid=\"dsub1\"]').first();
    const target = page.locator(`.week-col-body[data-date=\"${tomorrow}\"]`).first();
    await source.dragTo(target);
    await page.waitForTimeout(500);

    const afterDrag = await page.evaluate(({ today, tomorrow }) => {
      const tasks = JSON.parse(localStorage.getItem('ddl_tasks') || '[]');
      const t = tasks.find((x) => x.id === 'drag1');
      if (!t) return null;
      const td = t.assignedDays?.[today];
      const tm = t.assignedDays?.[tomorrow];
      const tmHours = tm ? (typeof tm === 'number' ? tm : tm.hours) : null;
      return { hasToday: !!td, tomorrowHours: tmHours };
    }, { today, tomorrow });
    const tc08DragPass = afterDrag && afterDrag.hasToday === false && approxEqual(afterDrag.tomorrowHours, 2);
    record('TC08-drag', tc08DragPass, afterDrag, { hasToday: false, tomorrowHours: 2 }, 'drag keeps raw hours');
    await mark(page, `TC08 drag hasToday=${afterDrag?.hasToday} tomorrowHours=${afterDrag?.tomorrowHours}`);
    await shot(page, 'tc08-drag-after-move.png');

    const removeBtn = page.locator(`.week-task-rm[data-sid=\"dsub1\"][data-date=\"${tomorrow}\"]`).first();
    await removeBtn.click();
    await page.waitForTimeout(400);

    const afterRemove = await page.evaluate(({ tomorrow }) => {
      const tasks = JSON.parse(localStorage.getItem('ddl_tasks') || '[]');
      const t = tasks.find((x) => x.id === 'drag1');
      if (!t) return null;
      return { hasTomorrow: !!t.assignedDays?.[tomorrow] };
    }, { tomorrow });
    const tc08RemovePass = afterRemove && afterRemove.hasTomorrow === false;
    record('TC08-remove', tc08RemovePass, afterRemove, { hasTomorrow: false }, 'remove does not leave inflated hours');
    await mark(page, `TC08 remove hasTomorrow=${afterRemove?.hasTomorrow}`);
    await shot(page, 'tc08-remove-after-click.png');

    await page.click('#newTaskBtn');
    await page.waitForSelector('#taskModal.open');
    await page.evaluate(() => {
      const input = document.getElementById('fTitle');
      input.value = '';
      input.focus();
      input.setSelectionRange(0, 0);
    });
    await page.keyboard.press('Tab');
    const afterEmptyTab = await page.evaluate(() => {
      const input = document.getElementById('fTitle');
      return {
        value: input.value,
        selectionStart: input.selectionStart,
        selectionEnd: input.selectionEnd
      };
    });
    const emptyFilled = typeof afterEmptyTab.value === 'string' && afterEmptyTab.value.trim().length > 0;
    const caretAtEnd =
      afterEmptyTab.selectionStart === afterEmptyTab.value.length &&
      afterEmptyTab.selectionEnd === afterEmptyTab.value.length;

    await page.evaluate(() => {
      const input = document.getElementById('fTitle');
      input.value = 'custom-title';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    await page.keyboard.press('Tab');
    const afterNonEmptyTab = await page.evaluate(() => {
      const input = document.getElementById('fTitle');
      return { value: input.value };
    });
    const preserveNonEmpty = afterNonEmptyTab.value === 'custom-title';
    const tc09Pass = emptyFilled && caretAtEnd && preserveNonEmpty;
    record(
      'TC09',
      tc09Pass,
      { afterEmptyTab, afterNonEmptyTab },
      { emptyFilled: true, caretAtEnd: true, preserveNonEmpty: true },
      'tab quick fill remains and non-empty value is not overridden'
    );
    await mark(page, `TC09 emptyFilled=${emptyFilled} caretAtEnd=${caretAtEnd} preserveNonEmpty=${preserveNonEmpty}`);
    await shot(page, 'tc09-tab-quick-fill.png');
    await page.click('#taskModalCancel');

    const summary = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      total: results.length,
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).length,
      results
    };
    fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
