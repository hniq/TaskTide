/**
 * TaskTide AI API 客户端
 * 调用后端 /api/parse-task 接口进行任务拆分
 */

const API_BASE_URL = window.location.origin; // 自动适配当前域名

/**
 * 调用 AI 拆分任务
 * @param {string} taskText - 任务描述文本
 * @returns {Promise<{success: boolean, subtasks: Array, error?: string}>}
 */
async function parseTaskWithAI(taskText) {
  if (!taskText || !taskText.trim()) {
    throw new Error('任务描述不能为空');
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/parse-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ task: taskText.trim() })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `请求失败: ${response.status}`);
    }

    return data;
  } catch (error) {
    console.error('AI 解析任务失败:', error);
    throw error;
  }
}

/**
 * 检查后端服务健康状态
 * @returns {Promise<boolean>}
 */
async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    const data = await response.json();
    return data.status === 'ok';
  } catch (error) {
    console.error('健康检查失败:', error);
    return false;
  }
}

/**
 * 带重试的 AI 任务解析
 * @param {string} taskText - 任务描述
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<Array>} - 子任务列表
 */
async function parseTaskWithRetry(taskText, maxRetries = 2) {
  let lastError;
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const result = await parseTaskWithAI(taskText);
      
      if (result.success && result.subtasks && result.subtasks.length > 0) {
        return result.subtasks;
      }
      
      // 如果解析成功但没有子任务，可能是格式问题
      if (!result.success) {
        throw new Error(result.error || 'AI 返回格式错误');
      }
      
      throw new Error('未能生成子任务');
    } catch (error) {
      lastError = error;
      console.warn(`第 ${i + 1} 次尝试失败:`, error.message);
      
      if (i < maxRetries) {
        // 等待 1 秒后重试
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  throw lastError;
}

// 导出 API（如果使用 ES Module）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseTaskWithAI, checkHealth, parseTaskWithRetry };
}
