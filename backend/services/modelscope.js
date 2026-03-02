const MODELSCOPE_API_KEY = process.env.DASHSCOPE_KEY;
const MODELSCOPE_API_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

/**
 * Parse natural language task description into structured data
 */
async function parseTask(text) {
  if (!MODELSCOPE_API_KEY) {
    throw new Error('DASHSCOPE_KEY environment variable not set');
  }

  const todayStr = formatDate(new Date());
  
  const sysPrompt = `你是任务规划助手。解析用户描述，返回纯JSON(无其他文本):
{"title":"任务标题","deadline":"YYYY-MM-DD","urgency":1-5,"importance":1-5,"estimatedHours":数字,"subtasks":[{"title":"名称","estimatedHours":数字}],"reasoning":"简短说明"}
规则:
- 今天是${todayStr}。"明天"=+1天,"后天"=+2天,"下周"=+7天,"N天后"=+N天
- urgency: <=1天=5, 2-3天=4, 4-7天=3, 8-14天=2, >14天=1
- importance: 工作/学习=4-5, 个人=3, 杂务=1-2
- estimatedHours合理: 简单0.5-2h, 中等2-8h, 复杂8-40h
- 总时长>6h时必须拆分为3-6个subtasks`;

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
