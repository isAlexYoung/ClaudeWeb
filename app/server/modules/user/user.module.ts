import { sessionDraftsDb, userDb, userPreferencesDb } from '@/modules/database/index.js';

import { createUserRouter } from './user.routes.js';
import { createUserService } from './user.service.js';

const userService = createUserService({
  users: {
    completeOnboarding: (userId) => userDb.completeOnboarding(userId),
    hasCompletedOnboarding: (userId) => userDb.hasCompletedOnboarding(userId),
  },
  preferences: {
    getPreferences: (userId) => userPreferencesDb.getPreferences(userId),
    savePreferences: (userId, updates) => userPreferencesDb.savePreferences(userId, updates),
  },
  drafts: {
    getDrafts: (userId) => sessionDraftsDb.getDrafts(userId),
    saveDraft: (userId, scope, draft) => sessionDraftsDb.saveDraft(userId, scope, draft),
    saveDraftText: (userId, scope, text) => sessionDraftsDb.saveDraftText(userId, scope, text),
    appendQueuedMessage: (userId, scope, message) => sessionDraftsDb.appendQueuedMessage(userId, scope, message),
    clearQueuedMessage: (userId, scope) => sessionDraftsDb.clearQueuedMessage(userId, scope),
    deleteDraft: (userId, scope) => sessionDraftsDb.deleteDraft(userId, scope),
  },
});

/** User router assembled for the authenticated server mount. */
export const userRoutes = createUserRouter(userService);
