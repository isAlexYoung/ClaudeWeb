import { GraphicalPanel } from '@/modules/graphical-panel';

/** WorkspaceToolsProvider keeps the browser mounted while its inspector is hidden. */
export default function BrowserPanel({ visible }: { visible: boolean }) {
  return <GraphicalPanel visible={visible} />;
}
