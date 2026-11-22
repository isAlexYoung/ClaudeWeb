import type { QueuedChatMessage } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** One chat scope's unsent composer text and queued message. */
type DraftRecord = {
  scope: string;
  text: string;
  queuedMessage: unknown | null;
  updatedAt: string;
};

type UserDependencies = {
  users: {
    completeOnboarding(userId: number): void;
    hasCompletedOnboarding(userId: number): boolean;
  };
  preferences: {
    getPreferences(userId: number): Record<string, unknown>;
    savePreferences(userId: number, updates: Record<string, unknown>): void;
  };
  drafts: {
    getDrafts(userId: number): DraftRecord[];
    saveDraft(userId: number, scope: string, draft: { text: string; queuedMessage: unknown | null }): void;
    saveDraftText(userId: number, scope: string, text: string): void;
    appendQueuedMessage(
      userId: number,
      scope: string,
      message: QueuedChatMessage,
    ): { queuedMessage: QueuedChatMessage; appended: boolean } | null;
    clearQueuedMessage(userId: number, scope: string): void;
    deleteDraft(userId: number, scope: string): void;
  };
};

/**
 * The longest a draft scope or preference key may be.
 *
 * Scopes are session UUIDs or `project:<id>`, and preference keys are fixed
 * identifiers, so anything longer is a client bug or an attempt to use the
 * table as general storage.
 */
const MAX_KEY_LENGTH = 200;

/** Guards against a runaway composer filling the database with one row. */
const MAX_DRAFT_TEXT_LENGTH = 100_000;

const readDraftScope = (value: unknown): string => {
  const scope = typeof value === 'string' ? value.trim() : '';
  if (!scope || scope.length > MAX_KEY_LENGTH) {
    throw new AppError('A draft scope of 1-200 characters is required', {
      code: 'INVALID_DRAFT_SCOPE',
      statusCode: 400,
    });
  }
  return scope;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

/** Reads the message the composer asks to queue; one with nothing to send is refused. */
const readQueuedMessageInput = (value: unknown): QueuedChatMessage => {
  const message = isPlainObject(value) ? value : {};
  const content = typeof message.content === 'string' ? message.content : '';
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (!content.trim() && attachments.length === 0) {
    throw new AppError('A queued message needs text or attachments', {
      code: 'INVALID_QUEUED_MESSAGE',
      statusCode: 400,
    });
  }
  return {
    content,
    ...(isPlainObject(message.options) ? { options: message.options } : {}),
    attachments,
  };
};

const readPreferenceUpdates = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('Preferences must be sent as an object', {
      code: 'INVALID_PREFERENCES',
      statusCode: 400,
    });
  }

  const updates = body as Record<string, unknown>;
  for (const key of Object.keys(updates)) {
    if (!key || key.length > MAX_KEY_LENGTH) {
      throw new AppError('Preference keys must be 1-200 characters', {
        code: 'INVALID_PREFERENCE_KEY',
        statusCode: 400,
      });
    }
  }

  return updates;
};

/** Creates user-profile workflows with explicit persistence adapters. */
export function createUserService(dependencies: UserDependencies) {
  return {
    completeOnboarding(userId: number) {
      dependencies.users.completeOnboarding(userId);
      return { success: true, message: 'Onboarding completed successfully' };
    },

    getOnboardingStatus(userId: number) {
      return {
        success: true,
        hasCompletedOnboarding: dependencies.users.hasCompletedOnboarding(userId),
      };
    },

    /** Every stored preference at once; the client fills gaps with its defaults. */
    getPreferences(userId: number) {
      return { success: true, preferences: dependencies.preferences.getPreferences(userId) };
    },

    /**
     * Merge-patch: only the keys in the request body are touched, so two
     * independent settings screens can save concurrently without one erasing
     * the other's work.
     */
    savePreferences(userId: number, body: unknown) {
      const updates = readPreferenceUpdates(body);
      dependencies.preferences.savePreferences(userId, updates);
      return { success: true, preferences: dependencies.preferences.getPreferences(userId) };
    },

    getDrafts(userId: number) {
      return { success: true, drafts: dependencies.drafts.getDrafts(userId) };
    },

    saveDraft(userId: number, scopeInput: unknown, body: unknown) {
      const scope = readDraftScope(scopeInput);
      const payload = (body ?? {}) as { text?: unknown; queuedMessage?: unknown };
      const text = typeof payload.text === 'string' ? payload.text : '';

      if (text.length > MAX_DRAFT_TEXT_LENGTH) {
        throw new AppError('Draft text is too long to store', {
          code: 'DRAFT_TEXT_TOO_LONG',
          statusCode: 413,
        });
      }

      // The composer's debounced save sends only the text. Its copy of the
      // queued message can be stale (already claimed by the dispatcher, or added
      // to from another tab), so a save without one leaves the stored one alone.
      if (payload.queuedMessage === undefined) {
        dependencies.drafts.saveDraftText(userId, scope, text);
        return { success: true };
      }

      dependencies.drafts.saveDraft(userId, scope, {
        text,
        queuedMessage: payload.queuedMessage ?? null,
      });
      return { success: true };
    },

    /**
     * Queues a message behind the session's running turn. A message already
     * waiting there is kept and this one is added after it, so a burst of
     * follow-ups all reach the provider, in order, as the next turn.
     *
     * A slash command is the one exception: it only works as a turn of its
     * own, so it is refused rather than merged, and the composer keeps it.
     */
    appendQueuedMessage(userId: number, scopeInput: unknown, queuedMessageInput: unknown) {
      const scope = readDraftScope(scopeInput);
      const message = readQueuedMessageInput(queuedMessageInput);
      const result = dependencies.drafts.appendQueuedMessage(userId, scope, message);
      if (!result) {
        throw new AppError(
          'A slash command runs as a turn of its own, so it cannot be combined with the queued message. '
            + 'Send it after the queued message has gone.',
          { code: 'QUEUED_MESSAGE_NOT_COMBINABLE', statusCode: 409 },
        );
      }
      return { success: true, queuedMessage: result.queuedMessage, appended: result.appended };
    },

    clearQueuedMessage(userId: number, scopeInput: unknown) {
      dependencies.drafts.clearQueuedMessage(userId, readDraftScope(scopeInput));
      return { success: true };
    },

    deleteDraft(userId: number, scopeInput: unknown) {
      dependencies.drafts.deleteDraft(userId, readDraftScope(scopeInput));
      return { success: true };
    },
  };
}
