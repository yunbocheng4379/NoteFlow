/**
 * NoteFlow Mini Program - Global State Store
 *
 * Based on WeChat Behavior for lightweight global state management.
 * Pages that need global state include this Behavior via:
 *   const store = require('../../store/store');
 *   Page({ behaviors: [store], ... })
 *
 * Key data fields:
 *   userInfo          - Current user object (null if not logged in)
 *   isLoggedIn        - Auth status flag
 *   credits           - Current credit balance
 *   activeSubscription - Active subscription info
 *   currentTask       - Active task being created/polled
 */

const { request } = require('../utils/request');
const { bus, Events } = require('../utils/event-bus');

const store = Behavior({
  data: {
    userInfo: null,
    isLoggedIn: false,
    credits: 0,
    activeSubscription: null,
    currentTaskId: null,
  },

  lifetimes: {
    attached() {
      // Sync with app globalData on behavior attach
      const app = getApp();
      this.setData({
        userInfo: app.globalData.userInfo || null,
        isLoggedIn: app.globalData.isLoggedIn || false,
        credits: app.globalData.credits || 0,
        activeSubscription: app.globalData.activeSubscription || null,
      });

      // Subscribe to events
      this._eventSubscriptions = [];
      this._eventSubscriptions.push(
        bus.on(Events.CREDITS_CHANGED, (credits) => {
          this.setData({ credits });
          app.globalData.credits = credits;
        }),
        bus.on(Events.SUBSCRIPTION_CHANGED, (subscription) => {
          this.setData({ activeSubscription: subscription });
          app.globalData.activeSubscription = subscription;
        }),
        bus.on(Events.LOGIN_SUCCESS, (userInfo) => {
          this.setData({ userInfo, isLoggedIn: true });
          app.globalData.userInfo = userInfo;
          app.globalData.isLoggedIn = true;
        }),
        bus.on(Events.LOGOUT, () => {
          this.setData({ userInfo: null, isLoggedIn: false, credits: 0, activeSubscription: null });
        }),
        bus.on(Events.USER_UPDATED, (userInfo) => {
          this.setData({ userInfo });
          app.globalData.userInfo = userInfo;
        })
      );
    },

    detached() {
      // Clean up subscriptions
      if (this._eventSubscriptions) {
        this._eventSubscriptions.forEach((unsub) => unsub());
      }
    },
  },

  methods: {
    /**
     * Update multiple store values
     * @param {Object} patch - key-value pairs to update
     */
    updateStore(patch) {
      this.setData(patch);
      const app = getApp();
      Object.keys(patch).forEach((key) => {
        app.globalData[key] = patch[key];
      });
    },

    /**
     * Refresh credit balance from server
     */
    async refreshBalance() {
      try {
        const data = await request({ url: '/api/billing/balance', suppressToast: true });
        const credits = data?.credits ?? data?.balance ?? 0;
        const activeSubscription = data?.active_subscription || null;

        this.updateStore({ credits, activeSubscription });

        bus.emit(Events.CREDITS_CHANGED, credits);
        bus.emit(Events.SUBSCRIPTION_CHANGED, activeSubscription);

        return { credits, activeSubscription };
      } catch (err) {
        console.warn('[Store] Failed to refresh balance:', err);
        return null;
      }
    },

    /**
     * Refresh user info from server
     */
    async refreshUserInfo() {
      try {
        const data = await request({ url: '/api/auth/me', suppressToast: true });
        const userInfo = data?.user || data;
        this.updateStore({ userInfo, isLoggedIn: true });

        bus.emit(Events.USER_UPDATED, userInfo);

        return userInfo;
      } catch (err) {
        console.warn('[Store] Failed to refresh user info:', err);
        return null;
      }
    },

    /**
     * Check if user has enough credits
     */
    hasEnoughCredits(required) {
      return this.data.credits >= required;
    },

    /**
     * Check if user has active subscription
     */
    hasSubscription() {
      return !!this.data.activeSubscription;
    },
  },
});

module.exports = store;
