// Backend API communication

const API_BASE = ''; // Same origin

export async function parseTaskWithAI(text, profileContext, templateInfo = null) {
  const body = { text };
  if (profileContext && (profileContext.tags?.length || profileContext.role || profileContext.purpose || profileContext.challenge)) {
    body.profile = profileContext;
  }
  if (templateInfo && templateInfo.label && templateInfo.fullText) {
    body.templateInfo = { label: templateInfo.label, fullText: templateInfo.fullText, groupName: templateInfo.groupName || '' };
  }
  const response = await fetch(`${API_BASE}/api/ai/parse-task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'AI parsing failed');
  }
  
  const data = await response.json();
  if (data.success && data.subtasks) {
    // 从输入文本解析日期（如果没有日期关键词，则不设置截止日期）
    const today = new Date();
    let deadline = null;
    
    // 匹配各种日期表达
    const m1 = text.match(/(\d+)\s*天/);
    if (m1) {
      const d = new Date(today);
      d.setDate(today.getDate() + parseInt(m1[1]));
      deadline = d.toISOString().split('T')[0];
    } else if (/明天/.test(text)) {
      const d = new Date(today);
      d.setDate(today.getDate() + 1);
      deadline = d.toISOString().split('T')[0];
    } else if (/后天/.test(text)) {
      const d = new Date(today);
      d.setDate(today.getDate() + 2);
      deadline = d.toISOString().split('T')[0];
    } else if (/下周/.test(text)) {
      const d = new Date(today);
      d.setDate(today.getDate() + 7);
      deadline = d.toISOString().split('T')[0];
    } else if (/下月/.test(text)) {
      const d = new Date(today);
      d.setMonth(today.getMonth() + 1);
      deadline = d.toISOString().split('T')[0];
    }
    // 如果没有匹配到日期，deadline 保持为 null（无截止日期）
    
    return {
      title: text.slice(0, 50),
      deadline: deadline,
      urgency: 3,
      importance: 3,
      estimatedHours: data.subtasks.reduce((sum, s) => sum + (s.estimatedHours || 1), 0),
      subtasks: data.subtasks,
      reasoning: 'AI智能拆分'
    };
  }
  throw new Error(data.error || 'Failed to parse task');
}

export async function checkAIHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
