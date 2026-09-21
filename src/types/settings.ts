import type { TestingMode } from './attempt';

export const CURRENT_SETTINGS_SCHEMA_VERSION = 1;

export type FontSize = 'small' | 'default' | 'large';
export type ContentWidth = 'default' | 'wide';

export interface AppSettings {
  schemaVersion: number;
  /** Mode used when creating the next attempt; also the live mode toggle default. */
  mode: TestingMode;
  autoAdvance: boolean;
  fontSize: FontSize;
  contentWidth: ContentWidth;
  keyboardShortcuts: boolean;
  /** Show upstream `reviewNote` values inline. Development/admin aid. */
  showReviewNotes: boolean;
  /** Apply `suggestedHighlights` from the bank data. */
  suggestedHighlights: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
  mode: 'tutor',
  autoAdvance: false,
  fontSize: 'default',
  contentWidth: 'default',
  keyboardShortcuts: true,
  showReviewNotes: false,
  suggestedHighlights: false,
};
