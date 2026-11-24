import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

import { api, readApiErrorMessage } from '@/shared/api';
import { AUTH_SESSION_EXPIRED_EVENT, AUTH_TOKEN_REFRESHED_EVENT, getAuthTokenRefreshDelay, isValidRefreshedToken, storeAuthToken } from '@/shared/authToken';
import { hydrateChatDrafts, resetChatDrafts } from '@/shared/chatDrafts';
import { resetSessionCaches } from '@/shared/sessionCache';
import { hydrateUserPreferences, resetUserPreferences } from '@/shared/userSettings';
/** The signed-in account held by AuthContext - a required `username` plus an optional id and any additional fields the auth API returns - and should be read through `useAuth()` rather than re-derived from raw auth responses. */
type AuthUser = {
  id?: number | string;
  username: string;
  [key: string]: unknown;
};

const AUTH_TOKEN_STORAGE_KEY = 'auth-token';

const AUTH_ERROR_MESSAGES = {
  authStatusCheckFailed: 'errors.authStatusCheckFailed',
  loginFailed: 'errors.loginFailed',
  invalidPassword: 'login.errors.invalidPassword',
  passwordNotSet: 'login.passwordNotSet',
  locked: 'login.errors.locked',
  cmcpExpired: 'login.errors.cmcpExpired',
  networkError: 'errors.networkError',
  sessionExpired: 'errors.sessionExpired',
} as const;

/** A device already signed in, as the login choice shows it. */
export type SignedInDevice = { ref: string; device: string; via: string; ip: string; at: number; main: boolean };

/** How this login treats the devices already signed in: keep them (`join`, optionally signing one out) or sign them all out. */
export type LoginChoice = { mode: 'join' | 'takeover'; replace?: string };

/**
 * A failed login carries `retryAfterSeconds` when this IP is locked out for a
 * while, or `choice` when other devices are signed in and the user must choose.
 */
type AuthActionResult =
  | { success: true }
  | { success: false; error: string; retryAfterSeconds?: number; choice?: { logins: SignedInDevice[]; max: number } };

type AuthSessionPayload = {
  token?: string;
  user?: AuthUser;
};

type AuthStatusPayload = {
  passwordConfigured?: boolean;
};

type AuthErrorPayload = {
  error?: { code?: unknown; details?: { retryAfterSeconds?: unknown; attemptsBeforeLock?: unknown; logins?: unknown; max?: unknown } };
};

type AuthUserPayload = {
  user?: AuthUser;
};

type OnboardingStatusPayload = {
  hasCompletedOnboarding?: boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  /** False when the server has no login password yet (root has to set one). */
  passwordConfigured: boolean;
  hasCompletedOnboarding: boolean;
  error: string | null;
  /** CMCP opened this page with a one-time sign-in code: login('') signs in with it. */
  cmcpSignIn: boolean;
  /** Drops the CMCP code, so the form asks for the password instead. */
  cancelCmcpSignIn: () => void;
  login: (password: string, choice?: LoginChoice) => Promise<AuthActionResult>;
  logout: () => void;
  refreshOnboardingStatus: () => Promise<void>;
};

type AuthProviderProps = {
  children: ReactNode;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

const readStoredToken = (): string | null => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

const persistToken = (token: string) => {
  storeAuthToken(token);
};

const clearStoredToken = () => {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

/**
 * CMCP opens ClaudeWeb at `/#cmcp=<code>`. The code is taken out of the
 * address at once, so it stays out of history and bookmarks.
 */
export function takeCmcpCode(): string | null {
  const match = /^#cmcp=([A-Za-z0-9_-]{20,200})$/.exec(window.location.hash);
  if (!match) return null;
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  return match[1];
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

/** Used by App to expose the session, and its login/logout actions, to every module through useAuth. */
export function AuthProvider({ children }: AuthProviderProps) {
  const { t } = useTranslation('auth');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [isLoading, setIsLoading] = useState(true);
  const [passwordConfigured, setPasswordConfigured] = useState(true);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cmcpCode, setCmcpCode] = useState<string | null>(() => takeCmcpCode());

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    clearStoredToken();
    // Otherwise the next person to sign in on this device would start out
    // looking at the previous user's theme, language, permissions and drafts.
    resetUserPreferences();
    resetChatDrafts();
    resetSessionCaches();
  }, []);

  // Preferences live in auth.db, so they can only be fetched once there is a
  // user to fetch them for. Until this resolves, every reader falls back to the
  // localStorage mirror of the last known server state.
  const userKey = user ? String(user.id ?? user.username) : null;
  useEffect(() => {
    if (!userKey) {
      return;
    }
    void hydrateUserPreferences();
    void hydrateChatDrafts();
  }, [userKey]);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonSafely<OnboardingStatusPayload>(response);
      setHasCompletedOnboarding(Boolean(payload?.hasCompletedOnboarding));
    } catch (caughtError) {
      console.error('Error checking onboarding status:', caughtError);
      // Fail open to avoid blocking access on transient onboarding status errors.
      setHasCompletedOnboarding(true);
    }
  }, []);

  const refreshOnboardingStatus = useCallback(async () => {
    await checkOnboardingStatus();
  }, [checkOnboardingStatus]);

  const refreshSession = useCallback(async () => {
    if (!token || !user) {
      return;
    }

    try {
      const response = await api.auth.refresh();
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonSafely<AuthSessionPayload>(response);
      if (isValidRefreshedToken(payload?.token)) {
        setToken(payload.token);
        persistToken(payload.token);
      }
    } catch (caughtError) {
      // A transient network failure must not sign the user out. Focus/visibility
      // and the next scheduled refresh will retry while the token remains valid.
      console.warn('[Auth] Session refresh failed:', caughtError);
    }
  }, [token, user]);

  useEffect(() => {
    const handleTokenRefreshed = (event: Event) => {
      const nextToken = (event as CustomEvent<unknown>).detail;
      if (isValidRefreshedToken(nextToken)) {
        setToken(nextToken);
      }
    };
    const handleSessionExpired = () => {
      clearSession();
      setError(t(AUTH_ERROR_MESSAGES.sessionExpired));
    };

    window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [clearSession, t]);

  // The startup check below needs `t` only for its failure message.
  // react-i18next gives `t` a new identity on every language change, so
  // depending on it would re-run that check - and swap the whole app for the
  // loading screen - whenever the language changes, including when sign-in
  // adopts the language saved on another device.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const statusResponse = await api.auth.status();
      const statusPayload = await parseJsonSafely<AuthStatusPayload>(statusResponse);

      setPasswordConfigured(statusPayload?.passwordConfigured !== false);

      // Read the stored token instead of depending on `token` state: this
      // bootstrap flips `isLoading`, which swaps the whole app for the loading
      // screen, so it must run once on mount and not again on every
      // X-Refreshed-Token rotation (each one remounted the workspace, #1269).
      if (!readStoredToken()) {
        return;
      }

      const userResponse = await api.auth.user();
      if (!userResponse.ok) {
        clearSession();
        return;
      }

      const userPayload = await parseJsonSafely<AuthUserPayload>(userResponse);
      if (!userPayload?.user) {
        clearSession();
        return;
      }

      setUser(userPayload.user);
      // Already signed in on this browser: the CMCP code is not needed.
      setCmcpCode(null);
      await checkOnboardingStatus();
    } catch (caughtError) {
      console.error('[Auth] Auth status check failed:', caughtError);
      setError(tRef.current(AUTH_ERROR_MESSAGES.authStatusCheckFailed));
    } finally {
      setIsLoading(false);
    }
  }, [checkOnboardingStatus, clearSession]);

  useEffect(() => {
    void checkAuthStatus();
  }, [checkAuthStatus]);

  useEffect(() => {
    if (!token || !user) {
      return undefined;
    }

    const refreshIfNeeded = () => {
      const refreshDelay = getAuthTokenRefreshDelay(token);
      if (refreshDelay !== null && refreshDelay <= 0) {
        void refreshSession();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshIfNeeded();
      }
    };

    const refreshDelay = getAuthTokenRefreshDelay(token);
    const refreshTimer = refreshDelay === null
      ? null
      : window.setTimeout(() => void refreshSession(), refreshDelay);

    window.addEventListener('focus', refreshIfNeeded);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      window.removeEventListener('focus', refreshIfNeeded);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshSession, token, user]);

  // ProtectedRoute shows the workspace as soon as there is a user, so the
  // onboarding status is settled before the user is published; otherwise a
  // user who still has to onboard would see the workspace mount for a whole
  // round trip before Onboarding replaced it. The token is stored first
  // because that request reads it from storage.
  const publishSession = useCallback(async (nextUser: AuthUser, nextToken: string) => {
    persistToken(nextToken);
    await checkOnboardingStatus();
    setUser(nextUser);
    setToken(nextToken);
    setPasswordConfigured(true);
  }, [checkOnboardingStatus]);

  const login = useCallback<AuthContextValue['login']>(
    async (password, choice) => {
      try {
        setError(null);
        const viaCmcp = !password && cmcpCode !== null;
        const response = viaCmcp
          ? await api.auth.cmcpRedeem(cmcpCode as string, choice)
          : await api.auth.login(password, choice);
        const payload = await parseJsonSafely<AuthSessionPayload & AuthErrorPayload>(response);

        if (!response.ok || !payload?.token || !payload.user) {
          // The login refusals ClaudeWeb itself sends are worded here, in the
          // page's language; anything else shows the server's message. Passing
          // the envelope's `error` object on would render it as a React child
          // and blank the screen.
          const code = payload?.error?.code;
          const details = payload?.error?.details;
          if (code === 'AUTH_LOCKED' && typeof details?.retryAfterSeconds === 'number') {
            return { success: false, error: t(AUTH_ERROR_MESSAGES.locked), retryAfterSeconds: details.retryAfterSeconds };
          }
          if ((code === 'AUTH_CHOICE_REQUIRED' || code === 'AUTH_DEVICE_LIMIT') && Array.isArray(details?.logins)) {
            return {
              success: false,
              error: '',
              choice: { logins: details.logins as SignedInDevice[], max: typeof details.max === 'number' ? details.max : 3 },
            };
          }
          if (code === 'AUTH_CMCP_CODE_INVALID') {
            setCmcpCode(null);
            return { success: false, error: t(AUTH_ERROR_MESSAGES.cmcpExpired) };
          }
          if (code === 'AUTH_PASSWORD_NOT_SET') {
            setPasswordConfigured(false);
            return { success: false, error: t(AUTH_ERROR_MESSAGES.passwordNotSet) };
          }
          const message = code === 'AUTH_INVALID_PASSWORD'
            ? t(AUTH_ERROR_MESSAGES.invalidPassword, { count: Number(details?.attemptsBeforeLock) || 0 })
            : readApiErrorMessage(payload) ?? t(AUTH_ERROR_MESSAGES.loginFailed);
          return { success: false, error: message };
        }

        if (viaCmcp) setCmcpCode(null);
        await publishSession(payload.user, payload.token);
        return { success: true };
      } catch (caughtError) {
        console.error('Login error:', caughtError);
        setError(t(AUTH_ERROR_MESSAGES.networkError));
        return { success: false, error: t(AUTH_ERROR_MESSAGES.networkError) };
      }
    },
    [cmcpCode, publishSession, t],
  );

  const cancelCmcpSignIn = useCallback(() => setCmcpCode(null), []);

  const logout = useCallback(() => {
    // The server forgets this device's session, so the token is dead even if
    // a copy survives. Sent before the token is cleared, since the request
    // reads it from storage; the page signs out whether or not it arrives.
    void api.auth.logout().catch((caughtError: unknown) => {
      console.warn('[Auth] Logout request failed:', caughtError);
    });
    clearSession();
  }, [clearSession]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      passwordConfigured,
      hasCompletedOnboarding,
      error,
      cmcpSignIn: cmcpCode !== null,
      cancelCmcpSignIn,
      login,
      logout,
      refreshOnboardingStatus,
    }),
    [
      cancelCmcpSignIn,
      cmcpCode,
      error,
      hasCompletedOnboarding,
      isLoading,
      login,
      logout,
      passwordConfigured,
      refreshOnboardingStatus,
      token,
      user,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
