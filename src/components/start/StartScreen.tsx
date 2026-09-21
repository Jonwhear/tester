import { Database, History, Play, RotateCcw, SlidersHorizontal } from 'lucide-react';

import type { AttemptMeta } from '../../types/attempt';

export interface StartScreenProps {
  bankCount: number;
  questionCount: number;
  activeAttempt: { meta: AttemptMeta; itemIndex: number; answered: number } | null;
  onResume: () => void;
  onNewAttempt: () => void;
  onOpenBanks: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  error?: string | null;
}

/**
 * Opening screen. Deliberately a small utility panel, not a landing page:
 * this should read like launching installed testing software.
 */
export function StartScreen({
  bankCount,
  questionCount,
  activeAttempt,
  onResume,
  onNewAttempt,
  onOpenBanks,
  onOpenHistory,
  onOpenSettings,
  error,
}: StartScreenProps) {
  return (
    <div className="start">
      <div className="start__panel">
        <div className="start__header">
          <h1 className="start__app">Question Bank — Examination</h1>
          <p className="start__meta">
            {bankCount === 0
              ? 'No question bank installed'
              : `${bankCount} bank${bankCount === 1 ? '' : 's'} installed · ${questionCount} question${
                  questionCount === 1 ? '' : 's'
                }`}
          </p>
        </div>

        <div className="start__body">
          {error ? <p className="banner banner--error">{error}</p> : null}

          {activeAttempt ? (
            <div className="start__resume">
              <div className="start__resume-title">Attempt in progress</div>
              <dl className="kv">
                <dt>Bank</dt>
                <dd>{activeAttempt.meta.bankTitle}</dd>
                <dt>Mode</dt>
                <dd>{activeAttempt.meta.mode === 'exam' ? 'Exam' : 'Tutor'}</dd>
                <dt>Position</dt>
                <dd>
                  Item {activeAttempt.itemIndex + 1} of {activeAttempt.meta.questionOrder.length} ·{' '}
                  {activeAttempt.answered} answered
                </dd>
                <dt>Last used</dt>
                <dd>{new Date(activeAttempt.meta.updatedAt).toLocaleString()}</dd>
              </dl>
            </div>
          ) : null}

          <div className="start__menu">
            {activeAttempt ? (
              <button type="button" className="menu-item menu-item--primary" onClick={onResume}>
                <RotateCcw size={16} aria-hidden="true" />
                <span>Resume Attempt</span>
                <span className="menu-item__hint">Item {activeAttempt.itemIndex + 1}</span>
              </button>
            ) : null}

            <button
              type="button"
              className={`menu-item${activeAttempt ? '' : ' menu-item--primary'}`}
              onClick={onNewAttempt}
            >
              <Play size={16} aria-hidden="true" />
              <span>Start New Attempt</span>
              <span className="menu-item__hint">
                {bankCount === 0 ? 'Needs a bank' : 'Choose bank and mode'}
              </span>
            </button>

            <button type="button" className="menu-item" onClick={onOpenBanks}>
              <Database size={16} aria-hidden="true" />
              <span>Question Bank</span>
              <span className="menu-item__hint">Import / manage</span>
            </button>

            <button type="button" className="menu-item" onClick={onOpenHistory}>
              <History size={16} aria-hidden="true" />
              <span>Attempt History</span>
              <span className="menu-item__hint">Past attempts</span>
            </button>

            <button type="button" className="menu-item" onClick={onOpenSettings}>
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span>Settings</span>
              <span className="menu-item__hint">Mode, display, progress</span>
            </button>
          </div>

          <p className="note">
            Progress is stored in this browser only. Nothing is uploaded anywhere.
          </p>
        </div>
      </div>
    </div>
  );
}
