import { beforeEach, describe, expect, it } from 'vitest';

import type { Attempt } from '../../types/attempt';
import type { QuestionBank } from '../../types/question';
import { createAttempt, checkAttemptCompatibility } from '../../state/attemptFactory';
import { applyAction } from '../../state/attemptReducer';
import { indexQuestions } from '../../data/normalize';
import {
  clearAllData,
  deleteAttempt,
  getBank,
  listAttemptMetas,
  listBanks,
  loadActiveAttemptId,
  loadAttempt,
  loadSettings,
  saveActiveAttemptId,
  saveAttempt,
  saveBank,
  saveResponse,
  saveSettings,
} from '../repositories';
import {
  buildPortableSession,
  buildProgressFile,
  parseProgressFile,
} from '../exportImport';
import { DEFAULT_SETTINGS } from '../../types/settings';

const bank: QuestionBank = {
  schemaVersion: 1,
  bankId: 'persist-bank',
  bankVersion: '1.0',
  title: 'Persistence bank',
  questions: [
    {
      id: 'P1',
      questionType: 'single',
      stem: 'one',
      options: [
        { label: 'A', text: 'a' },
        { label: 'B', text: 'b' },
      ],
      correctAnswer: ['B'],
    },
    {
      id: 'P2',
      questionType: 'single',
      stem: 'two',
      options: [
        { label: 'A', text: 'a' },
        { label: 'B', text: 'b' },
      ],
      correctAnswer: ['A'],
    },
  ],
};

const index = indexQuestions(bank);

beforeEach(async () => {
  await clearAllData();
});

describe('bank storage', () => {
  it('stores and reads a bank by id and version', async () => {
    const described = await saveBank(bank);
    expect(described.questionCount).toBe(2);
    expect(described.fullAnswerKey).toBe(true);

    const loaded = await getBank('persist-bank', '1.0');
    expect(loaded?.bank.questions).toHaveLength(2);
    expect(loaded?.checksum).toBe(described.checksum);
  });

  it('keeps two versions of the same bank side by side', async () => {
    await saveBank(bank);
    await saveBank({ ...bank, bankVersion: '2.0', title: 'Persistence bank v2' });
    const all = await listBanks();
    expect(all.map((b) => b.bankVersion).sort()).toEqual(['1.0', '2.0']);
  });
});

describe('attempt serialization and restoration', () => {
  it('round-trips an attempt with answers, marks and notes', async () => {
    await saveBank(bank);
    let attempt = createAttempt(bank, { mode: 'tutor' });
    const now = '2024-06-01T00:00:00.000Z';

    attempt = applyAction(attempt, { type: 'selectOption', questionId: 'P1', label: 'B' }, {
      questions: index,
      now,
    }).attempt;
    attempt = applyAction(attempt, { type: 'toggleMark', questionId: 'P2' }, {
      questions: index,
      now,
    }).attempt;
    attempt = applyAction(attempt, { type: 'setNotes', questionId: 'P1', notes: 'a note' }, {
      questions: index,
      now,
    }).attempt;
    attempt = applyAction(attempt, { type: 'navigate', questionId: 'P2' }, {
      questions: index,
      now,
    }).attempt;

    await saveAttempt(attempt);
    const restored = await loadAttempt(attempt.attemptId);

    expect(restored).toEqual(attempt);
    expect(restored?.currentQuestionId).toBe('P2');
    expect(restored?.responses.P1?.status).toBe('correct');
    expect(restored?.responses.P1?.notes).toBe('a note');
    expect(restored?.responses.P2?.marked).toBe(true);
  });

  it('persists a single response without rewriting the others', async () => {
    const attempt = createAttempt(bank, { mode: 'exam' });
    await saveAttempt(attempt);

    await saveResponse(attempt.attemptId, 'P2', {
      selectedAnswers: ['A'],
      status: 'answered',
      marked: true,
    });

    const restored = await loadAttempt(attempt.attemptId);
    expect(restored?.responses.P2?.selectedAnswers).toEqual(['A']);
    expect(restored?.responses.P2?.marked).toBe(true);
    expect(restored?.responses.P1?.selectedAnswers).toEqual([]);
  });

  it('restores the active attempt after a simulated refresh', async () => {
    await saveBank(bank);
    const attempt = createAttempt(bank, { mode: 'exam' });
    await saveAttempt(attempt);
    await saveActiveAttemptId(attempt.attemptId);

    const activeId = await loadActiveAttemptId();
    expect(activeId).toBe(attempt.attemptId);
    const restored = await loadAttempt(activeId as string);
    expect(restored?.attemptId).toBe(attempt.attemptId);
  });

  it('lists attempts newest first and deletes one with its responses', async () => {
    const first = { ...createAttempt(bank, { mode: 'exam' }), startedAt: '2024-01-01T00:00:00.000Z' };
    const second = { ...createAttempt(bank, { mode: 'tutor' }), startedAt: '2024-02-01T00:00:00.000Z' };
    await saveAttempt(first);
    await saveAttempt(second);

    expect((await listAttemptMetas()).map((m) => m.attemptId)).toEqual([
      second.attemptId,
      first.attemptId,
    ]);

    await deleteAttempt(second.attemptId);
    expect(await loadAttempt(second.attemptId)).toBeUndefined();
    expect(await loadAttempt(first.attemptId)).toBeDefined();
  });

  it('persists settings and merges in defaults for new keys', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'exam', fontSize: 'large' });
    const loaded = await loadSettings();
    expect(loaded.mode).toBe('exam');
    expect(loaded.fontSize).toBe('large');
    expect(loaded.keyboardShortcuts).toBe(DEFAULT_SETTINGS.keyboardShortcuts);
  });
});

describe('bank compatibility', () => {
  it('accepts an attempt against the bank it was created from', async () => {
    const stored = await saveBank(bank);
    const attempt = createAttempt(bank, { mode: 'exam' });
    expect(checkAttemptCompatibility(attempt, stored)).toEqual({ level: 'ok', messages: [] });
  });

  it('refuses an attempt when the bank is not installed', () => {
    const attempt = createAttempt(bank, { mode: 'exam' });
    const report = checkAttemptCompatibility(attempt, undefined);
    expect(report.level).toBe('error');
    expect(report.messages[0]).toMatch(/No question bank/);
  });

  it('refuses an attempt whose bank version differs', async () => {
    const stored = await saveBank({ ...bank, bankVersion: '2.0' });
    const attempt = createAttempt(bank, { mode: 'exam' });
    const report = checkAttemptCompatibility(attempt, stored);
    expect(report.level).toBe('error');
    expect(report.messages[0]).toMatch(/version mismatch/);
  });

  it('warns when the version matches but the content checksum does not', async () => {
    const attempt = createAttempt(bank, { mode: 'exam' });
    const edited = await saveBank({
      ...bank,
      questions: [
        { ...(bank.questions[0] as (typeof bank.questions)[number]), stem: 'edited stem' },
        bank.questions[1] as (typeof bank.questions)[number],
      ],
    });
    const report = checkAttemptCompatibility(attempt, edited);
    expect(report.level).toBe('warning');
    expect(report.messages[0]).toMatch(/checksum/);
  });

  it('refuses an attempt referencing questions the bank no longer has', async () => {
    const attempt = createAttempt(bank, { mode: 'exam' });
    const stored = await saveBank(bank);
    const broken: Attempt = { ...attempt, questionOrder: ['P1', 'GONE'] };
    const report = checkAttemptCompatibility(broken, stored);
    expect(report.level).toBe('error');
    expect(report.messages.some((m) => m.includes('GONE'))).toBe(true);
  });
});

describe('portable save files', () => {
  it('round-trips a progress export', async () => {
    const stored = await saveBank(bank);
    const attempt = createAttempt(bank, { mode: 'tutor' });
    const file = buildProgressFile(stored, [attempt]);

    const outcome = parseProgressFile(JSON.parse(JSON.stringify(file)));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.parsed.kind).toBe('progress');
    expect(outcome.parsed.attempts[0]).toEqual(attempt);
    expect(outcome.parsed.bankChecksum).toBe(stored.checksum);
    expect(checkAttemptCompatibility(outcome.parsed.attempts[0] as Attempt, stored).level).toBe('ok');
  });

  it('does not embed the bank in a progress export', async () => {
    const stored = await saveBank(bank);
    const file = buildProgressFile(stored, [createAttempt(bank, { mode: 'exam' })]);
    expect(JSON.stringify(file)).not.toContain('"questions"');
  });

  it('round-trips a portable session that carries its bank', () => {
    const attempt = createAttempt(bank, { mode: 'exam' });
    const file = buildPortableSession(bank, [attempt]);
    const outcome = parseProgressFile(JSON.parse(JSON.stringify(file)));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.parsed.kind).toBe('portable-session');
    expect(outcome.parsed.bank?.questions).toHaveLength(2);
  });

  it('rejects an unrecognized file', () => {
    const outcome = parseProgressFile({ hello: 'world' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors[0]).toMatch(/Unrecognized file/);
  });

  it('rejects a progress file whose attempt is structurally broken', () => {
    const outcome = parseProgressFile({
      kind: 'qbank-progress',
      fileVersion: 1,
      exportedAt: 'now',
      bank: { bankId: 'x', bankVersion: '1' },
      attempts: [{ attemptId: 'a', responses: {} }],
    });
    expect(outcome.ok).toBe(false);
  });

  it('rejects an attempt whose currentQuestionId is not in its order', () => {
    const attempt = createAttempt(bank, { mode: 'exam' });
    const outcome = parseProgressFile({ ...attempt, currentQuestionId: 'ELSEWHERE' });
    expect(outcome.ok).toBe(false);
  });

  it('accepts a bare attempt object as a convenience', () => {
    const attempt = createAttempt(bank, { mode: 'exam' });
    const outcome = parseProgressFile(JSON.parse(JSON.stringify(attempt)));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.parsed.attempts).toHaveLength(1);
  });
});
