import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Lock } from 'lucide-react';

import { useAuth } from '@/modules/auth/context/AuthContext';
import AuthErrorAlert from '@/modules/auth/AuthErrorAlert';
import AuthInputField from '@/modules/auth/AuthInputField';
import AuthScreenLayout from '@/modules/auth/AuthScreenLayout';

function formatWait(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Login form component.
 * Rendered by the auth module's ProtectedRoute when no user session exists.
 * The server has one login password, set by root, so the form asks for that
 * alone. A hidden user name lets password managers file the password under
 * this server. After too many wrong passwords the form counts down the
 * lockout the server reports.
 */
export default function LoginForm() {
  const { t } = useTranslation('auth');
  const { error: sessionError, login, passwordConfigured } = useAuth();

  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockedSeconds, setLockedSeconds] = useState(0);

  useEffect(() => {
    if (lockedSeconds <= 0) return undefined;
    const timer = window.setTimeout(() => setLockedSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [lockedSeconds]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      if (!password) {
        setErrorMessage(t('login.errors.requiredFields'));
        return;
      }

      setIsSubmitting(true);
      const result = await login(password);
      if (!result.success) {
        if (result.retryAfterSeconds) {
          setLockedSeconds(result.retryAfterSeconds);
        } else {
          setErrorMessage(result.error);
        }
      }
      setIsSubmitting(false);
    },
    [login, password, t],
  );

  const locked = lockedSeconds > 0;
  const shownError = locked
    ? t('login.errors.locked', { time: formatWait(lockedSeconds) })
    : errorMessage || sessionError || (passwordConfigured ? '' : t('login.passwordNotSet'));

  return (
    <AuthScreenLayout
      title={t('login.title')}
      description={t('login.description')}
      footerText={t('login.footerText')}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="text" name="username" autoComplete="username" value="ClaudeWeb" readOnly hidden />

        <AuthInputField
          id="password"
          label={t('login.password')}
          value={password}
          onChange={setPassword}
          placeholder={t('login.placeholders.password')}
          isDisabled={isSubmitting}
          type="password"
          autoComplete="current-password"
          icon={Lock}
        />

        <AuthErrorAlert errorMessage={shownError} />

        <button
          type="submit"
          disabled={isSubmitting || locked}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-primary/30 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-card active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('login.loading')}
            </>
          ) : (
            t('login.submit')
          )}
        </button>
      </form>
    </AuthScreenLayout>
  );
}
