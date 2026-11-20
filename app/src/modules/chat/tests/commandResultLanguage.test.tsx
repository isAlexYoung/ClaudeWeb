import { expect, test } from 'vitest';
import { render } from '@testing-library/react';

import CommandResultModal from '@/modules/chat/modals/CommandResultModal';
import { i18n } from '@/modules/i18n';
import type { ProviderModelActions } from '@/shared/types';

const props = { onClose: () => {}, providerModelCatalog: {}, providerModelActions: {} as ProviderModelActions,
  activeProvider: 'claude' as const, activeProviderModel: 'sonnet', currentSessionId: 'session', onSelectProviderModel: async () => ({ scope: 'session' as const, model: 'sonnet' }) };
test('built-in help, cost and status content follows the interface language', async () => {
  await i18n.changeLanguage('zh-CN');
  try {
    const help = render(<CommandResultModal {...props} payload={{ kind: 'help', data: { commands: [{ name: '/help', namespace: 'builtin', description: 'Show help documentation for Claude Code' }] } }} />);
    expect(help.getByText('语法')).toBeTruthy(); expect(help.getByText('内置')).toBeTruthy();
    expect(help.queryByText('Show help documentation for Claude Code')).toBeNull();
    expect(help.getByText('使用提示')).toBeTruthy(); help.unmount();
    const cost = render(<CommandResultModal {...props} payload={{ kind: 'cost', data: { tokenUsage: { used: 120 } } }} />);
    expect(cost.getByText('已使用 Token 总数')).toBeTruthy(); cost.unmount();
    const status = render(<CommandResultModal {...props} payload={{ kind: 'status', data: { version: 'test' } }} />);
    expect(status.getByText('运行服务在线')).toBeTruthy(); expect(status.getByText('运行平台')).toBeTruthy(); status.unmount();
  } finally { await i18n.changeLanguage('en'); }
});
