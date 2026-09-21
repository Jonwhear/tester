/**
 * Bundled development fixtures.
 *
 * To ship your own bank instead:
 *   1. drop your generated JSON at `src/sample-data/sample-bank.json`, or
 *   2. delete these imports and import your bank at runtime from
 *      Settings -> Question Banks (nothing else references this folder).
 */
import type { QuestionBank } from '../types/question';
import sampleBankJson from './sample-bank.json';
import sampleRowsJson from './sample-rows.json';

/** Already in normalized form — cast is safe because it is validated on load. */
export const SAMPLE_BANK = sampleBankJson as unknown as QuestionBank;

/** Row-format example, used by the "Load row-format sample" action. */
export const SAMPLE_ROWS: unknown = sampleRowsJson;
