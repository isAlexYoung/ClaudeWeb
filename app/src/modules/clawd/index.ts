// Clawd, the Claude Code mascot, as pixel animations: Clawd 400 by 风花叶 — CC BY 4.0
// (https://github.com/khiqwq/clawd-400). Unofficial fan art; the character belongs to Anthropic.
export { default as ClawdSprite } from '@/modules/clawd/ClawdSprite';
export { default as ClawdGreeting } from '@/modules/clawd/ClawdGreeting';
export { default as ClawdHeading } from '@/modules/clawd/ClawdHeading';
export { CLAWD_STATE_ANIMATIONS, nextAnimation, randomAnimation, stateForTool } from '@/modules/clawd/states';
export type { ClawdState } from '@/modules/clawd/states';
export type { ClawdMode } from '@/modules/clawd/greetings';
export { useClawdPreferences } from '@/modules/clawd/useClawdPreferences';
