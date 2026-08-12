/**
 * NoteFlow Mini Program - Cross-Page Event Bus
 *
 * Lightweight pub/sub system for cross-page communication
 * where globalData falls short (e.g., balance updates, login state changes).
 */

class EventBus {
  constructor() {
    this._listeners = {};
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} callback
   * @param {Object} context - 'this' context for the callback
   * @returns {Function} Unsubscribe function
   */
  on(event, callback, context) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }

    const handler = { callback, context };
    this._listeners[event].push(handler);

    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  /**
   * Subscribe to an event once
   * @param {string} event
   * @param {Function} callback
   * @param {Object} context
   */
  once(event, callback, context) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      callback.apply(context, args);
    };
    wrapper._original = callback;
    this.on(event, wrapper);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event
   * @param {Function} callback - If omitted, removes all listeners for event
   */
  off(event, callback) {
    if (!this._listeners[event]) return;

    if (!callback) {
      delete this._listeners[event];
      return;
    }

    this._listeners[event] = this._listeners[event].filter(
      (h) => h.callback !== callback && h.callback._original !== callback
    );
  }

  /**
   * Emit an event
   * @param {string} event
   * @param {...any} args
   */
  emit(event, ...args) {
    const handlers = this._listeners[event];
    if (!handlers || handlers.length === 0) return;

    handlers.forEach(({ callback, context }) => {
      try {
        callback.apply(context, args);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err);
      }
    });
  }

  /**
   * Remove all listeners
   */
  clear() {
    this._listeners = {};
  }
}

// Predefined event names
const Events = {
  // Auth
  LOGIN_SUCCESS: 'auth:login_success',
  LOGOUT: 'auth:logout',
  USER_UPDATED: 'auth:user_updated',

  // Credits
  CREDITS_CHANGED: 'billing:credits_changed',
  SUBSCRIPTION_CHANGED: 'billing:subscription_changed',

  // Tasks
  TASK_CREATED: 'task:created',
  TASK_STATUS_CHANGED: 'task:status_changed',
  TASK_DELETED: 'task:deleted',
  TASK_UPDATED: 'task:updated',

  // Notes
  NOTE_TITLE_CHANGED: 'note:title_changed',
  NOTE_CONTENT_CHANGED: 'note:content_changed',

  // Collection
  COLLECTION_CHANGED: 'collection:changed',

  // UI
  TAB_CHANGED: 'ui:tab_changed',
};

const bus = new EventBus();

module.exports = { bus, Events };
