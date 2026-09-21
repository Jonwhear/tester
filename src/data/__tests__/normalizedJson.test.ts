import { describe, expect, it } from 'vitest';

import { importNormalizedBank } from '../importers/normalizedJson';
import { SAMPLE_BANK } from '../../sample-data';
import { CURRENT_BANK_SCHEMA_VERSION } from '../../types/question';

describe('normalized bank importer', () => {
  it('accepts the bundled fixture bank', () => {
    const result = importNormalizedBank(SAMPLE_BANK);
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.bank?.questions).toHaveLength(10);
  });

  it('warns about questions with no answer key without failing the import', () => {
    const result = importNormalizedBank(SAMPLE_BANK);
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.level === 'warning' && i.message.includes('answer key'))).toBe(
      true,
    );
  });

  it('refuses a bank from a newer schema version with a readable message', () => {
    const result = importNormalizedBank({
      ...SAMPLE_BANK,
      schemaVersion: CURRENT_BANK_SCHEMA_VERSION + 5,
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toMatch(/schemaVersion/);
  });

  it('names the offending question when validation fails', () => {
    const broken = {
      ...SAMPLE_BANK,
      questions: [
        SAMPLE_BANK.questions[0],
        { ...SAMPLE_BANK.questions[1], id: 'BROKEN-Q', correctAnswer: ['Z'] },
      ],
    };
    const result = importNormalizedBank(broken);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.questionId === 'BROKEN-Q')).toBe(true);
  });

  it('rejects duplicate question ids', () => {
    const result = importNormalizedBank({
      ...SAMPLE_BANK,
      questions: [SAMPLE_BANK.questions[0], SAMPLE_BANK.questions[0]],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('duplicate question id'))).toBe(true);
  });

  it('points an array at the row importer instead of failing obscurely', () => {
    const result = importNormalizedBank([{ row_type: 'question' }]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toMatch(/row format/i);
  });

  it('does not invent a correct answer for an unkeyed question', () => {
    const result = importNormalizedBank(SAMPLE_BANK);
    const unkeyed = result.bank?.questions.find((q) => q.id === '2024-P1-Q005');
    expect(unkeyed).toBeDefined();
    expect(unkeyed?.correctAnswer).toBeUndefined();
  });
});
