/**
 * Repository layer.
 *
 * The rest of the application talks to these functions, never to IndexedDB
 * directly. Swapping in a remote backend later means reimplementing this file.
 *
 * Responses are stored as one record per (attempt, question) rather than as a
 * blob on the attempt. A bank may hold thousands of questions, and answering
 * one of them must not rewrite the other 999.
 */
import type { Attempt, AttemptMeta, QuestionResponse } from '../types/attempt';
import type { AppSettings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { QuestionBank, StoredBank } from '../types/question';
import { describeBank } from '../data/normalize';
import { settingsSchema } from '../data/schema';
import {
  RESPONSE_ATTEMPT_INDEX,
  STORE_ATTEMPTS,
  STORE_BANKS,
  STORE_KV,
  STORE_RESPONSES,
  clearStore,
  get,
  getAll,
  getAllByIndex,
  put,
  putMany,
  remove,
  removeByIndex,
} from './db';

/* ------------------------------------------------------------------ */
/* Key/value                                                           */
/* ------------------------------------------------------------------ */

interface KvRecord<T> {
  key: string;
  value: T;
}

const KEY_SETTINGS = 'settings';
const KEY_ACTIVE_ATTEMPT = 'activeAttemptId';

export async function loadSettings(): Promise<AppSettings> {
  const record = await get<KvRecord<unknown>>(STORE_KV, KEY_SETTINGS);
  if (!record) return DEFAULT_SETTINGS;
  const parsed = settingsSchema.safeParse(record.value);
  if (!parsed.success) return DEFAULT_SETTINGS;
  // Merge so that settings added in a later build get their default.
  return { ...DEFAULT_SETTINGS, ...parsed.data };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await put<KvRecord<AppSettings>>(STORE_KV, { key: KEY_SETTINGS, value: settings });
}

export async function loadActiveAttemptId(): Promise<string | null> {
  const record = await get<KvRecord<string | null>>(STORE_KV, KEY_ACTIVE_ATTEMPT);
  return record?.value ?? null;
}

export async function saveActiveAttemptId(attemptId: string | null): Promise<void> {
  await put<KvRecord<string | null>>(STORE_KV, { key: KEY_ACTIVE_ATTEMPT, value: attemptId });
}

/* ------------------------------------------------------------------ */
/* Banks                                                               */
/* ------------------------------------------------------------------ */

interface BankRecord extends StoredBank {
  key: string;
}

export function bankKey(bankId: string, bankVersion: string): string {
  return `${bankId}::${bankVersion}`;
}

export async function saveBank(bank: QuestionBank, builtIn = false): Promise<StoredBank> {
  const described = describeBank(bank, builtIn);
  const record: BankRecord = { ...described, key: bankKey(bank.bankId, bank.bankVersion) };
  await put<BankRecord>(STORE_BANKS, record);
  return described;
}

export async function listBanks(): Promise<StoredBank[]> {
  const records = await getAll<BankRecord>(STORE_BANKS);
  return records
    .map(({ key: _key, ...rest }) => rest)
    .sort((a, b) => a.title.localeCompare(b.title) || a.bankVersion.localeCompare(b.bankVersion));
}

export async function getBank(
  bankId: string,
  bankVersion: string,
): Promise<StoredBank | undefined> {
  const record = await get<BankRecord>(STORE_BANKS, bankKey(bankId, bankVersion));
  if (!record) return undefined;
  const { key: _key, ...rest } = record;
  return rest;
}

/** Any stored version of a bank id, newest import first. */
export async function getBankVersions(bankId: string): Promise<StoredBank[]> {
  const all = await listBanks();
  return all
    .filter((b) => b.bankId === bankId)
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

export async function deleteBank(bankId: string, bankVersion: string): Promise<void> {
  await remove(STORE_BANKS, bankKey(bankId, bankVersion));
}

/* ------------------------------------------------------------------ */
/* Attempts                                                            */
/* ------------------------------------------------------------------ */

interface ResponseRecord {
  key: string;
  attemptId: string;
  questionId: string;
  response: QuestionResponse;
}

function responseKey(attemptId: string, questionId: string): string {
  return `${attemptId}::${questionId}`;
}

function toMeta(attempt: Attempt): AttemptMeta {
  const { responses: _responses, ...meta } = attempt;
  return meta;
}

/** Create/overwrite an attempt header and all of its responses. */
export async function saveAttempt(attempt: Attempt): Promise<void> {
  await put<AttemptMeta>(STORE_ATTEMPTS, toMeta(attempt));
  const records: ResponseRecord[] = Object.entries(attempt.responses).map(
    ([questionId, response]) => ({
      key: responseKey(attempt.attemptId, questionId),
      attemptId: attempt.attemptId,
      questionId,
      response,
    }),
  );
  await putMany(STORE_RESPONSES, records);
}

/** Header-only write. Used for navigation, mode and completion changes. */
export async function saveAttemptMeta(attempt: AttemptMeta): Promise<void> {
  await put<AttemptMeta>(STORE_ATTEMPTS, attempt);
}

/** Single-question write. The hot path — deliberately O(1). */
export async function saveResponse(
  attemptId: string,
  questionId: string,
  response: QuestionResponse,
): Promise<void> {
  await put<ResponseRecord>(STORE_RESPONSES, {
    key: responseKey(attemptId, questionId),
    attemptId,
    questionId,
    response,
  });
}

/** Batched multi-question write, used when an exam attempt is graded. */
export async function saveResponses(
  attemptId: string,
  responses: Record<string, QuestionResponse>,
): Promise<void> {
  const records: ResponseRecord[] = Object.entries(responses).map(([questionId, response]) => ({
    key: responseKey(attemptId, questionId),
    attemptId,
    questionId,
    response,
  }));
  await putMany(STORE_RESPONSES, records);
}

export async function loadAttempt(attemptId: string): Promise<Attempt | undefined> {
  const meta = await get<AttemptMeta>(STORE_ATTEMPTS, attemptId);
  if (!meta) return undefined;
  const records = await getAllByIndex<ResponseRecord>(
    STORE_RESPONSES,
    RESPONSE_ATTEMPT_INDEX,
    attemptId,
  );
  const responses: Record<string, QuestionResponse> = {};
  records.forEach((record) => {
    responses[record.questionId] = record.response;
  });
  return { ...meta, responses };
}

export async function listAttemptMetas(): Promise<AttemptMeta[]> {
  const metas = await getAll<AttemptMeta>(STORE_ATTEMPTS);
  return metas.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function deleteAttempt(attemptId: string): Promise<void> {
  await removeByIndex(STORE_RESPONSES, RESPONSE_ATTEMPT_INDEX, attemptId);
  await remove(STORE_ATTEMPTS, attemptId);
  const active = await loadActiveAttemptId();
  if (active === attemptId) await saveActiveAttemptId(null);
}

/** Wipe everything. Used by Settings → "Clear all local data". */
export async function clearAllData(): Promise<void> {
  await clearStore(STORE_RESPONSES);
  await clearStore(STORE_ATTEMPTS);
  await clearStore(STORE_BANKS);
  await clearStore(STORE_KV);
}
