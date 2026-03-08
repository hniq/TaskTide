const express = require('express');
const router = express.Router();
const modelscopeService = require('../services/modelscope');

// Parse task using LLM
router.post('/parse-task', async (req, res) => {
  try {
    const { text, profile, templateInfo } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid text parameter' });
    }

    const result = await modelscopeService.parseTask(text, profile, templateInfo);
    res.json(result);
  } catch (error) {
    console.error('Parse task error:', error);
    res.status(500).json({ 
      error: 'Failed to parse task', 
      message: error.message 
    });
  }
});

// Health check for AI service
router.get('/health', async (req, res) => {
  try {
    // Simple health check - verify API key is configured
    const isHealthy = modelscopeService.isConfigured();
    res.json({ 
      status: isHealthy ? 'ok' : 'not_configured',
      service: 'modelscope'
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

module.exports = router;
