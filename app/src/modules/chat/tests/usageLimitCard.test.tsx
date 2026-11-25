import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeAll, describe, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { ChatMessage, ScheduledMessage } from '@/shared/types';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import UsageLimitCard from '@/modules/chat/transcript/UsageLimitCard';
import { UsageLimitResumeContext } from '@/modules/chat/context/UsageLimitResumeContext';
import type { UsageLimitResumeValue } from '@/modules/chat/context/UsageLimitResumeContext';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import {
  USAGE_LIMIT_RESUME_OPTION,
  parseUsageLimitNotice,
  usageLimitResumeSchedule,
} from '@/modules/chat/utils/usageLimitNotice';
import type { UsageLimitNotice } from '@/modules/chat/utils/usageLimitNotice';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const iso = (notice: UsageLimitNotice | null) => notice?.resetsAt?.toISOString() ?? null;

describe('reading the limit message', () => {
  test("the 5-hour notice resolves to that wall time in the message's time zone, after the message", () => {
    const notice = parseUsageLimitNotice("You've hit your 5-hour limit · resets 9:20pm (Asia/Singapore)", '2026-11-25T11:35:00.000Z');
    assert.deepEqual({ ...notice, resetsAt: iso(notice) }, {
      kind: 'fiveHour', label: '5-hour', resetText: '9:20pm', timeZone: 'Asia/Singapore', resetsAt: '2026-11-25T13:20:00.000Z',
    });
    // Written at 23:00 there, "1am" is the next day.
    assert.equal(iso(parseUsageLimitNotice("You've hit your 5-hour limit · resets 1am (Asia/Singapore)", '2026-11-25T15:00:00.000Z')), '2026-11-25T17:00:00.000Z');
    // The curly apostrophe Claude Code may write reads the same.
    assert.equal(parseUsageLimitNotice('You’ve hit your 5-hour limit · resets 9:20pm (Asia/Singapore)', '2026-11-25T11:35:00.000Z')?.kind, 'fiveHour');
  });

  test('weekly notices with a date or a weekday, across a year end and a DST change', () => {
    assert.equal(iso(parseUsageLimitNotice("You've hit your weekly limit · resets Dec 2, 9am (Asia/Singapore)", '2026-11-25T11:35:00.000Z')), '2026-12-02T01:00:00.000Z');
    assert.equal(iso(parseUsageLimitNotice("You've hit your weekly limit · resets Jan 2, 9am (Asia/Singapore)", '2026-12-30T00:00:00.000Z')), '2027-01-02T01:00:00.000Z');
    // 2026-11-25 is a Wednesday.
    assert.equal(iso(parseUsageLimitNotice("You've hit your weekly limit · resets Mon 9am (Asia/Singapore)", '2026-11-25T11:35:00.000Z')), '2026-11-30T01:00:00.000Z');
    // New York moves to summer time at 2am on 8 March 2026: 9am that day is 13:00 UTC.
    assert.equal(iso(parseUsageLimitNotice("You've hit your limit · resets 9am (America/New_York)", '2026-03-08T05:00:00.000Z')), '2026-03-08T13:00:00.000Z');
  });

  test('the older wordings, the kind of limit, and the browser time zone when none is named', () => {
    const local = parseUsageLimitNotice('5-hour limit reached ∙ resets 1am', new Date(2026, 10, 25, 22, 0));
    assert.equal(local?.kind, 'fiveHour');
    assert.equal(local?.timeZone, null);
    assert.equal(local?.resetsAt?.getTime(), new Date(2026, 10, 26, 1, 0).getTime());
    assert.equal(parseUsageLimitNotice('Opus weekly limit reached ∙ resets Oct 9, 4pm', '2026-10-05T00:00:00Z')?.kind, 'opusWeekly');
    assert.equal(parseUsageLimitNotice("You've hit your Opus limit · resets 4pm", '2026-10-05T00:00:00Z')?.kind, 'opus');
    assert.equal(parseUsageLimitNotice("You've hit your limit · resets 4pm", '2026-10-05T00:00:00Z')?.kind, 'generic');
    assert.equal(iso(parseUsageLimitNotice('Claude AI usage limit reached|1763906400')), new Date(1763906400000).toISOString());
  });

  test('anything else stays a reply', () => {
    assert.equal(parseUsageLimitNotice("You've hit your limit on what I can say about this."), null);
    assert.equal(parseUsageLimitNotice('Claude usage limit reached.'), null);
    assert.equal(parseUsageLimitNotice("Sure.\nYou've hit your 5-hour limit · resets 9:20pm (Asia/Singapore)"), null);
    // A reset that cannot be read keeps the card but with no countdown.
    const unreadable = parseUsageLimitNotice("You've hit your 5-hour limit · resets soon (Asia/Singapore)");
    assert.equal(unreadable?.resetsAt, null);
    assert.equal(unreadable?.resetText, 'soon');
  });

  test('the continue message goes a minute after the reset with the run options and the reset it belongs to', () => {
    const resetsAt = new Date('2026-11-25T13:20:00.000Z');
    assert.deepEqual(usageLimitResumeSchedule(resetsAt, 'continue', { model: 'opus', permissionMode: 'acceptEdits' }), {
      content: 'continue',
      scheduledFor: new Date('2026-11-25T13:21:00.000Z'),
      options: { model: 'opus', permissionMode: 'acceptEdits', [USAGE_LIMIT_RESUME_OPTION]: '2026-11-25T13:20:00.000Z' },
    });
  });
});

const MINUTE = 60_000;

const noticeIn = (ms: number): UsageLimitNotice => ({
  kind: 'fiveHour', label: '5-hour', resetText: '9:20pm', timeZone: 'Asia/Singapore', resetsAt: new Date(Date.now() + ms),
});

const scheduled = (notice: UsageLimitNotice, fields: Partial<ScheduledMessage>): ScheduledMessage => ({
  id: 'm1',
  sessionId: 'session-1',
  content: 'continue',
  options: { [USAGE_LIMIT_RESUME_OPTION]: notice.resetsAt!.toISOString() },
  scheduledFor: new Date(notice.resetsAt!.getTime() + MINUTE).toISOString(),
  status: 'pending',
  failureReason: null,
  createdAt: new Date().toISOString(),
  ...fields,
});

const renderCard = (notice: UsageLimitNotice, resume: { scheduledMessages?: ScheduledMessage[] } | null, isExporting = false) => {
  const scheduleResume = vi.fn(async (_resetsAt: Date) => true);
  const cancel = vi.fn(async (_id: string) => undefined);
  const value: UsageLimitResumeValue | null = resume && { scheduledMessages: resume.scheduledMessages ?? [], scheduleResume, cancel };
  const view = render(
    <UsageLimitResumeContext.Provider value={value}>
      <UsageLimitCard notice={notice} rawText="You've hit your 5-hour limit · resets 9:20pm (Asia/Singapore)" isExporting={isExporting} />
    </UsageLimitResumeContext.Provider>,
  );
  return { view, scheduleResume, cancel };
};

describe('the limit card', () => {
  test('says which limit, when it resets and how long that is, and schedules the continue message when ticked', async () => {
    const notice = noticeIn(83 * MINUTE + 30_000);
    const { view, scheduleResume } = renderCard(notice, {});
    view.getByRole('group', { name: "You've hit your 5-hour limit" });
    assert.match(view.container.textContent ?? '', /Time left1 h 24 min/);
    const box = view.getByRole('checkbox', { name: /Continue automatically when the limit resets/ }) as HTMLInputElement;
    assert.equal(box.checked, false);
    assert.match(view.container.textContent ?? '', /My usage limit ran out a moment ago/);
    fireEvent.click(box);
    await waitFor(() => assert.deepEqual(scheduleResume.mock.calls, [[notice.resetsAt]]));
  });

  test('a scheduled continue message shows as ticked, and unticking cancels it', async () => {
    const notice = noticeIn(30 * MINUTE);
    const { view, cancel } = renderCard(notice, {
      scheduledMessages: [
        scheduled(notice, { id: 'other', options: { [USAGE_LIMIT_RESUME_OPTION]: '2020-01-01T00:00:00.000Z' } }),
        scheduled(notice, { id: 'm1' }),
      ],
    });
    const box = view.getByRole('checkbox') as HTMLInputElement;
    assert.equal(box.checked, true);
    fireEvent.click(box);
    await waitFor(() => assert.deepEqual(cancel.mock.calls, [['m1']]));
  });

  test('after the reset: the sent message is reported, and nothing is offered when none was set', () => {
    const notice = noticeIn(-5 * MINUTE);
    const sent = renderCard(notice, { scheduledMessages: [scheduled(notice, { status: 'sent' })] });
    assert.match(sent.view.container.textContent ?? '', /Your limit has reset/);
    assert.match(sent.view.container.textContent ?? '', /The continue message was sent at/);
    assert.equal(sent.view.queryByRole('checkbox'), null);
    sent.view.unmount();

    const none = renderCard(notice, {});
    assert.equal(none.view.queryByRole('checkbox'), null);
    none.view.unmount();

    const failed = renderCard(notice, { scheduledMessages: [scheduled(notice, { status: 'failed', failureReason: 'The session was unavailable.' })] });
    assert.match(failed.view.getByRole('alert').textContent ?? '', /not sent: The session was unavailable\./);
  });

  test('an exported transcript, or one outside a session, shows the limit without the option', () => {
    const exported = renderCard(noticeIn(30 * MINUTE), {}, true);
    assert.equal(exported.view.queryByRole('checkbox'), null);
    exported.view.unmount();
    const bare = renderCard(noticeIn(30 * MINUTE), null);
    assert.equal(bare.view.queryByRole('checkbox'), null);
    assert.match(bare.view.container.textContent ?? '', /Resets/);
  });
});

test('the transcript draws the limit reply as the card', () => {
  const message: ChatMessage = {
    type: 'assistant',
    content: "You've hit your 5-hour limit · resets 9:20pm (Asia/Singapore)",
    timestamp: new Date().toISOString(),
  };
  const view = render(
    <UiPreferencesProvider>
      <MessageComponent message={message} prevMessage={null} createDiff={() => []} provider="claude" />
    </UiPreferencesProvider>,
  );
  view.getByRole('group', { name: "You've hit your 5-hour limit" });
  assert.match(view.container.textContent ?? '', /Time left/);
});
