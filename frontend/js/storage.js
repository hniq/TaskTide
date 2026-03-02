// Local storage operations

import { TASKS_KEY, SETTINGS_KEY, DEFAULT_SETTINGS } from './utils.js';

export function loadTasks() {
  try {
    const d = localStorage.getItem(TASKS_KEY);
    return d ? JSON.parse(d) : [];
  } catch {
    return [];
  }
}

export function saveTasks(tasks) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

export function loadSettings() {
  try {
    const d = localStorage.getItem(SETTINGS_KEY);
    return d ? { ...DEFAULT_SETTINGS, ...JSON.parse(d) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
