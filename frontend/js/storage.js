// Local storage operations

import { TASKS_KEY, SETTINGS_KEY, PROFILE_KEY, DEFAULT_SETTINGS, DEFAULT_PROFILE, buildProfileTags } from './utils.js';

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

export function loadProfile() {
  try {
    const d = localStorage.getItem(PROFILE_KEY);
    if (!d) return { ...DEFAULT_PROFILE };
    const p = JSON.parse(d);
    p.tags = buildProfileTags(p);
    return { ...DEFAULT_PROFILE, ...p };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveProfile(profile) {
  const p = { ...profile };
  p.tags = buildProfileTags(p);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}
