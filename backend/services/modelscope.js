const MODELSCOPE_API_KEY = process.env.DASHSCOPE_KEY;
const MODELSCOPE_API_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

/**
 * Parse natural language task description into structured data
 * @param {string} text - 用户任务描述（新建任务标题/具体内容）
 * @param {object} [profile] - 用户画像 { tags, role, purpose, challenge }
 * @param {object} [templateInfo] - 写死模板信息 { label, fullText, groupName }，涉及模板时先带模板再让 LLM 细化
 */
async function parseTask(text, profile, templateInfo) {
  if (!MODELSCOPE_API_KEY) {
    throw new Error('DASHSCOPE_KEY environment variable not set');
  }

  const todayStr = formatDate(new Date());
  const parts = [];

  // 用户身份角色、时间管理挑战、使用目的（tags 顺序：身份、目的、挑战；可能仅 2 项为身份+挑战）
  if (profile && profile.tags && profile.tags.length > 0) {
    const roleLabel = profile.tags[0] || '';
    const purposeLabel = profile.tags.length >= 3 ? profile.tags[1] : '';
    const challengeLabel = profile.tags.length >= 2 ? profile.tags[profile.tags.length - 1] : '';
    if (roleLabel) parts.push(`用户身份角色：${roleLabel}`);
    if (purposeLabel) parts.push(`使用目的：${purposeLabel}`);
    if (challengeLabel) parts.push(`时间管理挑战：${challengeLabel}`);
  }
  if (parts.length > 0) {
    parts.push('请据此调整拆分粒度、表述和优先级建议，使子任务更贴合该用户类型。');
  }

  let templateBlock = '';
  if (templateInfo && templateInfo.label && templateInfo.fullText) {
    templateBlock = `

本任务属于【${templateInfo.label}】类目标（${templateInfo.groupName || ''}）。参考模板内容如下：
---
${templateInfo.fullText}
---
请先结合上述模板的阶段与要点，再对用户当前描述进行细化拆分，使子任务更贴合该类型目标且可执行。`;
  }

  const userContext = parts.length > 0 ? `\n${parts.join('；')}` : '';
  const taskContext = `\n当前任务标题/具体内容将作为用户消息在下方给出，请据此解析并拆分。`;

  const sysPrompt = `你是任务规划助手。解析用户描述，返回纯JSON(无其他文本):
{"title":"任务标题","deadline":"YYYY-MM-DD","urgency":1-5,"importance":1-5,"estimatedHours":数字,"subtasks":[{"title":"名称","estimatedHours":数字}],"reasoning":"简短说明"}
规则:
- 今天是${todayStr}。"明天"=+1天,"后天"=+2天,"下周"=+7天,"N天后"=+N天
- urgency: <=1天=5, 2-3天=4, 4-7天=3, 8-14天=2, >14天=1
- importance: 工作/学习=4-5, 个人=3, 杂务=1-2
- estimatedHours合理: 简单0.5-2h, 中等2-8h, 复杂8-40h
- 总时长>6h时必须拆分为3-6个subtasks${userContext}${taskContext}${templateBlock}`;

  const response = await fetch(MODELSCOPE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MODELSCOPE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'qwen-max',
      input: {
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: text }
        ]
      },
      parameters: {
        temperature: 0.7,
        result_format: 'message'
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.output?.choices?.[0]?.message?.content;
  
  if (!content) {
    throw new Error('Empty response from API');
  }

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse JSON from response');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  
  // Validate required fields
  if (!parsed.title || !parsed.deadline) {
    throw new Error('Missing required fields in response');
  }

  return parsed;
}

function formatDate(d) {
  return d.getFullYear() + '-' + 
    String(d.getMonth() + 1).padStart(2, '0') + '-' + 
    String(d.getDate()).padStart(2, '0');
}

function isConfigured() {
  return !!MODELSCOPE_API_KEY;
}

module.exports = {
  parseTask,
  isConfigured
};
