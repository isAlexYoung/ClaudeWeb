import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Lock, MonitorSmartphone } from 'lucide-react';

import { useAuth } from '@/modules/auth/context/AuthContext';
import type { LoginChoice, SignedInDevice } from '@/modules/auth/context/AuthContext';
import AuthErrorAlert from '@/modules/auth/AuthErrorAlert';
import AuthInputField from '@/modules/auth/AuthInputField';
import AuthScreenLayout from '@/modules/auth/AuthScreenLayout';

function formatWait(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

const BUTTON = 'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-medium transition-all duration-200 '
  + 'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-card active:scale-[0.99] '
  + 'disabled:cursor-not-allowed disabled:opacity-60';
const PRIMARY = `${BUTTON} bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110`;
const SECONDARY = `${BUTTON} border border-border bg-background text-foreground hover:bg-muted/60`;
const DANGER = `${BUTTON} bg-red-600 text-white hover:bg-red-500`;

/**
 * Login form component.
 * Rendered by the auth module's ProtectedRoute when no user session exists.
 * The server has one login password, set by root, so the form asks for that
 * alone. A hidden user name lets password managers file the password under
 * this server. After too many wrong passwords the form counts down the
 * lockout the server reports. When other devices are signed in, it asks
 * whether to join them or take over (signing them out), and when three are in
 * already, which one to sign out. Opened by CMCP with a one-time code, it
 * signs in with that code at once and asks for the password only when the
 * code no longer works.
 */
export default function LoginForm() {
  const { t } = useTranslation('auth');
  const { error: sessionError, login, passwordConfigured, cmcpSignIn, cancelCmcpSignIn } = useAuth();

  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockedSeconds, setLockedSeconds] = useState(0);
  const [choice, setChoice] = useState<{ logins: SignedInDevice[]; max: number } | null>(null);
  const [confirmingTakeover, setConfirmingTakeover] = useState(false);

  useEffect(() => {
    if (lockedSeconds <= 0) return undefined;
    const timer = window.setTimeout(() => setLockedSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [lockedSeconds]);

  const submit = useCallback(async (answer?: LoginChoice) => {
    setErrorMessage('');
    if (!password && !cmcpSignIn) {
      setErrorMessage(t('login.errors.requiredFields'));
      return;
    }
    setIsSubmitting(true);
    const result = await login(password, answer);
    if (!result.success) {
      if (result.choice) {
        setChoice(result.choice);
        setConfirmingTakeover(false);
      } else if (result.retryAfterSeconds) {
        setChoice(null);
        setLockedSeconds(result.retryAfterSeconds);
      } else {
        setErrorMessage(result.error);
      }
    }
    setIsSubmitting(false);
  }, [cmcpSignIn, login, password, t]);

  const cmcpStarted = useRef(false);
  useEffect(() => {
    if (!cmcpSignIn || cmcpStarted.current) return;
    cmcpStarted.current = true;
    void submit();
  }, [cmcpSignIn, submit]);

  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submit();
  }, [submit]);

  const locked = lockedSeconds > 0;
  const shownError = locked
    ? t('login.errors.locked', { time: formatWait(lockedSeconds) })
    : errorMessage || sessionError || (passwordConfigured ? '' : t('login.passwordNotSet'));

  const deviceLine = (device: SignedInDevice) => [
    device.device || t('login.choice.unknownDevice'),
    device.via === 'cmcp' ? 'CMCP' : null,
    device.ip || null,
    device.main ? t('login.choice.main') : null,
  ].filter(Boolean).join(' · ');

  if (choice) {
    const full = choice.logins.length >= choice.max;
    return (
      <AuthScreenLayout title={t('login.choice.title')} description={t(full ? 'login.choice.full' : 'login.choice.description', { max: choice.max })}
        footerText={t('login.footerText')}>
        <div className="space-y-4" data-testid="login-choice">
          <ul className="space-y-2">
            {choice.logins.map((device) => (
              <li key={device.ref} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                <MonitorSmartphone className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{deviceLine(device)}</span>
                {full && (
                  <button type="button" disabled={isSubmitting} className="text-xs text-primary underline disabled:opacity-60"
                    onClick={() => void submit({ mode: 'join', replace: device.ref })}>
                    {t('login.choice.replace')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <AuthErrorAlert errorMessage={errorMessage} />
          {confirmingTakeover ? (
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/40 p-3">
              <p className="text-sm text-foreground">{t('login.choice.confirmTakeover')}</p>
              <button type="button" disabled={isSubmitting} className={DANGER} onClick={() => void submit({ mode: 'takeover' })}>
                {t('login.choice.confirmTakeoverButton')}
              </button>
              <button type="button" disabled={isSubmitting} className={SECONDARY} onClick={() => setConfirmingTakeover(false)}>
                {t('login.choice.cancel')}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {!full && (
                <button type="button" disabled={isSubmitting} className={PRIMARY} onClick={() => void submit({ mode: 'join' })}>
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('login.choice.join')}
                </button>
              )}
              <button type="button" disabled={isSubmitting} className={SECONDARY} onClick={() => setConfirmingTakeover(true)}>
                {t('login.choice.takeover')}
              </button>
              <button type="button" disabled={isSubmitting} className="w-full py-1 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => { setChoice(null); setPassword(''); cancelCmcpSignIn(); }}>
                {t('login.choice.cancel')}
              </button>
            </div>
          )}
        </div>
      </AuthScreenLayout>
    );
  }

  return (
    <AuthScreenLayout
      title={t('login.title')}
      description={t(cmcpSignIn ? 'login.cmcpSigningIn' : 'login.description')}
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

        <button type="submit" disabled={isSubmitting || locked} className={PRIMARY}>
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
