import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import { SensitiveAccessPanel } from '@/modules/chat/tools/InteractiveRenderers/SensitiveAccessPanel';

const request = {
  requestId: 'sens-1',
  toolName: 'ClaudeWebSensitiveAccess',
  input: { toolName: 'Bash', toolInput: { command: 'cat ~/.claude/.credentials.json' }, kinds: ['claudeCredentials', 'nonsense'] },
};

describe('the sensitive information card', () => {
  it('says what the call would reach and answers for this call only', () => {
    const onDecision = vi.fn();
    render(<SensitiveAccessPanel request={request} onDecision={onDecision} />);

    expect(screen.getByText("This is the user's sensitive information")).toBeTruthy();
    expect(screen.getByText("Claude's login credentials")).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(/cat ~\/\.claude\/\.credentials\.json/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refuse' }));
    expect(onDecision).toHaveBeenLastCalledWith('sens-1', { allow: false, message: 'The user refused access to their sensitive information.' });
    fireEvent.click(screen.getByRole('button', { name: 'Allow this once' }));
    expect(onDecision).toHaveBeenLastCalledWith('sens-1', { allow: true });
  });
});
