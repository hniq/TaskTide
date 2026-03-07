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
  const normalizeSettingsShape = (raw) => {
    const base = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    const weekly = Array.isArray(base.weeklyAvailability) ? base.weeklyAvailability : [];
    const weeklySlots = Array.isArray(base.weeklyAvailabilitySlots) ? base.weeklyAvailabilitySlots : [];

    if (!weekly.length && weeklySlots.length) {
      base.weeklyAvailability = weeklySlots.map(slot => ({
        weekday: Number(slot?.dayOfWeek),
        start: String(slot?.start || ''),
        end: String(slot?.end || '')
      }));
    } else if (weekly.length) {
      base.weeklyAvailability = weekly.map(slot => ({
        weekday: Number(slot?.weekday),
        start: String(slot?.start || ''),
        end: String(slot?.end || '')
      }));
    } else {
      base.weeklyAvailability = [];
    }

    if (!weeklySlots.length && base.weeklyAvailability.length) {
      base.weeklyAvailabilitySlots = base.weeklyAvailability.map(slot => ({
        dayOfWeek: Number(slot?.weekday),
        start: String(slot?.start || ''),
        end: String(slot?.end || '')
      }));
    } else if (weeklySlots.length) {
      base.weeklyAvailabilitySlots = weeklySlots.map(slot => ({
        dayOfWeek: Number(slot?.dayOfWeek),
        start: String(slot?.start || ''),
        end: String(slot?.end || '')
      }));
    } else {
      base.weeklyAvailabilitySlots = [];
    }

    return base;
  };

  try {
    const d = localStorage.getItem(SETTINGS_KEY);
    if (!d) {
      const defaults = normalizeSettingsShape(DEFAULT_SETTINGS);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults));
      return defaults;
    }
    const normalized = normalizeSettingsShape(JSON.parse(d));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    const defaults = normalizeSettingsShape(DEFAULT_SETTINGS);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults));
    return defaults;
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
