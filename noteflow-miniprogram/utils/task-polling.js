/**
 * NoteFlow Mini Program - Task Polling Manager
 *
 * Manages polling intervals for task status updates.
 * Automatically pauses on app hide and resumes on show.
 */

const ENV = require('../.env.js');
const { request } = require('./request');
const { mapTaskStatus } = require('./contracts');

class TaskPollingManager {
  constructor() {
    // { taskId: { timer, callback, attempts, paused } }
    this._pollers = {};
  }

  /**
   * Start polling a task
   * @param {string}   taskId
   * @param {Function} callback  - (data) => void, receives task status response
   * @returns {boolean} true if started, false if already polling
   */
  start(taskId, callback) {
    if (this._pollers[taskId]) {
      return false;
    }

    this._pollers[taskId] = {
      timer: null,
      callback,
      attempts: 0,
      paused: false,
    };

    this._poll(taskId);
    return true;
  }

  /**
   * Stop polling a task
   */
  stop(taskId) {
    const poller = this._pollers[taskId];
    if (!poller) return;

    if (poller.timer) {
      clearInterval(poller.timer);
    }
    delete this._pollers[taskId];
  }

  /**
   * Pause a specific poller (but keep it registered)
   */
  pause(taskId) {
    const poller = this._pollers[taskId];
    if (!poller) return;

    this.stop(taskId);

    // Re-register with paused flag
    this._pollers[taskId] = {
      ...poller,
      timer: null,
      paused: true,
    };
  }

  /**
   * Pause all pollers (called on app hide)
   */
  pauseAll() {
    const taskIds = Object.keys(this._pollers);
    taskIds.forEach((id) => {
      const poller = this._pollers[id];
      if (poller.timer) {
        clearInterval(poller.timer);
        this._pollers[id] = {
          ...poller,
          timer: null,
          paused: true,
        };
      }
    });
  }

  /**
   * Resume all paused pollers (called on app show)
   */
  resumeAll() {
    const taskIds = Object.keys(this._pollers);
    taskIds.forEach((id) => {
      const poller = this._pollers[id];
      if (poller.paused) {
        this._pollers[id].paused = false;
        this._poll(id);
      }
    });
  }

  /**
   * Stop all pollers
   */
  stopAll() {
    Object.keys(this._pollers).forEach((id) => this.stop(id));
  }

  /**
   * Check if a task is currently being polled
   */
  isPolling(taskId) {
    return !!this._pollers[taskId] && !this._pollers[taskId].paused;
  }

  /**
   * Get count of active pollers
   */
  get activeCount() {
    return Object.values(this._pollers).filter((p) => !p.paused).length;
  }

  /**
   * Internal poll function
   */
  _poll(taskId) {
    const poller = this._pollers[taskId];
    if (!poller || poller.paused) return;

    // Do an immediate first poll
    this._doRequest(taskId);

    // Then set up interval
    poller.timer = setInterval(() => {
      this._doRequest(taskId);
    }, ENV.POLLING_INTERVAL);
  }

  async _doRequest(taskId) {
    const poller = this._pollers[taskId];
    if (!poller || poller.paused) return;

    poller.attempts++;

    try {
      const data = await request({
        url: `/api/task_status/${taskId}`,
        suppressToast: true,
        dedup: false,
      });

      // Call the callback with data
      if (poller.callback) {
        poller.callback(data);
      }

      // Stop polling if terminal state
      const status = mapTaskStatus(data?.status || data?.task_status);
      if (status.terminal) {
        this.stop(taskId);
      }

      // Stop if max attempts reached
      if (poller.attempts >= ENV.MAX_POLLING_ATTEMPTS) {
        this.stop(taskId);
        if (poller.callback) {
          poller.callback({ status: 'TIMEOUT', message: '任务处理超时，请稍后重试' });
        }
      }
    } catch (err) {
      // Network errors don't stop polling, but max attempts still apply
      if (poller.attempts >= ENV.MAX_POLLING_ATTEMPTS) {
        this.stop(taskId);
      }
    }
  }
}

// Singleton
const pollingManager = new TaskPollingManager();
module.exports = pollingManager;
