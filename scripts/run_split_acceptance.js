const fs = require('fs');
const path = require('path');

function loadPlaywrightChromium() {
  try {
    const { chromium } = require('playwright');
    return chromium;
  } catch (_) {
    const localPlaywright = path.resolve(__dirname, '../frontend/node_modules/playwright');
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { chromium } = require(localPlaywright);
    return chromium;
  }
}

const chromium = loadPlaywrightChromium();
const BASE_URL = 'http://127.0.0.1:4173/index.html';
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT_DIR = path.resolve(process.cwd(), 'artifacts/split-acceptance-20260307');

fs.mkdirSync(OUT_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  dailyWorkHours: 4,
  splitThreshold: 6,
  autoAssignAfterSplit: true,
  defaultCalendarView: 'week',
  habitMemory: { taskPatterns: [] }
};

const results = [];

function buildTask({
  id,
  title,
  estimatedHours = 8,
  subtasks = [],
  status = 'active',
  manualOrder = 0
}) {
  return {
    id,
    title,
    deadline: null,
    estimatedHours,
    importance: 3,
    urgency: 3,
    eisenhowerQuadrant: 'Q2',
    status,
    subtasks,
    notes: '',
    manualPriority: null,
    assignedDays: {},
    manualOrder,
    createdAt: new Date().toISOString(),
    createdBy: 'manual'
  };
}

function record(id, pass, actual, expected, note = '') {
  results.push({ id, pass, actual, expected, note });
}

function sumHours(items) {
  return items.reduce((sum, item) => sum + (Number(item.hours) || 0), 0);
}

function approxEqual(a, b, eps = 1e-6) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function shot(page, filename) {
  await page.screenshot({ path: path.join(OUT_DIR, filename), fullPage: true });
}

async function setParseRoute(page, payload) {
  await page.unroute('**/api/parse-task').catch(() => {});
  await page.route('**/api/parse-task', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });
  });
}

async function setState(page, tasks, settings = DEFAULT_SETTINGS) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ tasks, settings }) => {
    localStorage.setItem('ddl_tasks', JSON.stringify(tasks));
    localStorage.setItem('ddl_settings', JSON.stringify(settings));
  }, { tasks, settings });
  await page.reload({ waitUntil: 'networkidle' });
}

async function openTaskDetail(page, taskId) {
  await page.click(`.tcard[data-id="${taskId}"]`);
  await page.waitForSelector('#detailPanel.open');
  await page.waitForSelector('#detailAISplitBtn');
}

async function readDetailSplitItems(page) {
  return page.$$eval('#detailSplitItems .split-item', nodes => {
    return nodes.map(node => {
      const title = node.querySelector('.split-title-input')?.value?.trim() || '';
      const hours = parseFloat(node.querySelector('.split-hours-input')?.value || '0');
      return { title, hours };
    });
  });
}

async function readLegacySplitItems(page) {
  return page.$$eval('#splitItems .split-item', nodes => {
    return nodes.map(node => {
      const title = node.querySelector('.split-title-input')?.value?.trim() || '';
      const hours = parseFloat(node.querySelector('.split-hours-input')?.value || '0');
      return { title, hours };
    });
  });
}

async function codeEvidenceShot(page) {
  const mainPath = path.resolve(process.cwd(), 'frontend/js/main.js');
  const source = fs.readFileSync(mainPath, 'utf8');
  const markerA = 'function getTemplateSplit(t, totalHoursOverride = null)';
  const markerB = 'const subs = getTemplateSplit(t, total);';
  const idxA = source.indexOf(markerA);
  const idxB = source.indexOf(markerB);
  let snippet = source;

  if (idxA >= 0 && idxB >= 0) {
    const from = Math.max(0, idxA - 220);
    const to = Math.min(source.length, idxB + 220);
    snippet = source.slice(from, to);
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent(`
    <html>
      <head>
        <style>
          body { margin: 0; background: #0f172a; color: #e2e8f0; font-family: Consolas, Menlo, monospace; }
          .wrap { padding: 20px; }
          h1 { font-size: 16px; margin: 0 0 12px 0; }
          pre { white-space: pre-wrap; line-height: 1.5; font-size: 13px; background: #111827; border: 1px solid #334155; border-radius: 8px; padding: 16px; }
          .tag { color: #93c5fd; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <h1>Code Evidence: <span class="tag">getTemplateSplit(t, total)</span></h1>
          <pre>${escapeHtml(snippet)}</pre>
        </div>
      </body>
    </html>
  `);
  await shot(page, 'ex2-code-getTemplateSplit-param.png');
}

async function run() {
  const launchOptions = { headless: true };
  if (fs.existsSync(EDGE_PATH)) launchOptions.executablePath = EDGE_PATH;
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.__TT_QA__ = true;
  });

  try {
    // Example 1: paper task 10h should be non-average and front-heavy.
    await setParseRoute(page, { success: true, subtasks: [] });
    await setState(page, [buildTask({ id: 'ex1', title: '完成课程论文', estimatedHours: 10 })]);
    await openTaskDetail(page, 'ex1');
    await page.fill('#detailSplitHours', '10');
    await page.click('#detailAISplitBtn');
    await page.waitForSelector('#detailSplitItems .split-item');
    const ex1Items = await readDetailSplitItems(page);
    await shot(page, 'ex1-paper-10h-template.png');

    const ex1Total = sumHours(ex1Items);
    const ex1NotAverage = !ex1Items.every(item => approxEqual(item.hours, 2.5));
    const ex1FrontHeavy =
      ex1Items.length >= 4 &&
      (ex1Items[0].hours + ex1Items[1].hours) > (ex1Items[2].hours + ex1Items[3].hours);
    record(
      'EX1',
      ex1Items.length >= 4 && approxEqual(ex1Total, 10) && ex1NotAverage && ex1FrontHeavy,
      { items: ex1Items, total: ex1Total },
      'Non-average and front-heavy split for paper task 10h'
    );

    // Example 2: detail split and legacy modal split should match for same task + same total.
    await setParseRoute(page, { success: true, subtasks: [] });
    await setState(page, [buildTask({ id: 'ex2', title: '完成课程论文', estimatedHours: 8 })]);
    await openTaskDetail(page, 'ex2');
    await page.fill('#detailSplitHours', '8');
    await page.click('#detailAISplitBtn');
    await page.waitForSelector('#detailSplitItems .split-item');
    const ex2DetailItems = await readDetailSplitItems(page);
    await shot(page, 'ex2-detail-preview-8h.png');

    await page.evaluate(async taskId => {
      await window.__TT_QA_openLegacySplitModal(taskId);
    }, 'ex2');
    await page.waitForSelector('#splitModal.open');
    await page.evaluate(totalHours => {
      window.__TT_QA_regenerateLegacySplit(totalHours);
    }, 8);
    await page.waitForTimeout(200);
    const ex2LegacyItems = await readLegacySplitItems(page);
    await shot(page, 'ex2-legacy-regenerate-8h.png');

    const ex2Same =
      JSON.stringify(ex2DetailItems.map(i => ({ title: i.title, hours: i.hours }))) ===
      JSON.stringify(ex2LegacyItems.map(i => ({ title: i.title, hours: i.hours })));
    record(
      'EX2',
      ex2Same,
      { detail: ex2DetailItems, legacy: ex2LegacyItems },
      'Detail preview and legacy regenerate should match for same total'
    );

    await codeEvidenceShot(page);

    // Example 3: intentionally bad AI data should fallback/normalize.
    await setParseRoute(page, {
      success: true,
      subtasks: [
        { title: '', estimatedHours: 12 },
        { title: '随便做做', estimatedHours: 9 },
        { title: '随便再做', estimatedHours: 8 },
        { title: '最后补一补', estimatedHours: 7 }
      ]
    });
    await setState(page, [buildTask({ id: 'ex3', title: '学习线性代数', estimatedHours: 8 })]);
    await openTaskDetail(page, 'ex3');
    await page.fill('#detailSplitHours', '8');
    await page.click('#detailAISplitBtn');
    await page.waitForSelector('#detailSplitItems .split-item');
    const ex3Items = await readDetailSplitItems(page);
    await shot(page, 'ex3-ai-invalid-fallback-or-normalized.png');

    const ex3Total = sumHours(ex3Items);
    const ex3NoEmptyTitle = ex3Items.every(item => item.title);
    const ex3Reasonable = ex3NoEmptyTitle && approxEqual(ex3Total, 8);
    record(
      'EX3',
      ex3Reasonable,
      { items: ex3Items, total: ex3Total },
      'Invalid AI output should fallback or normalize to reasonable split'
    );

    fs.writeFileSync(
      path.join(OUT_DIR, 'results.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          outDir: OUT_DIR,
          results
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
