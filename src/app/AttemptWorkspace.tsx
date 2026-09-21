import { useCallback, useState } from 'react';

import type { Attempt } from '../types/attempt';
import { emptyResponse } from '../types/attempt';
import type { AppSettings } from '../types/settings';
import type { StoredBank } from '../types/question';
import { useAttemptEngine } from '../hooks/useAttemptEngine';
import { saveAttempt } from '../storage/repositories';
import { ExamScreen } from '../components/exam/ExamScreen';
import { ReviewScreen } from '../components/review/ReviewScreen';
import type { SettingsDialogProps } from '../components/dialogs/SettingsDialog';

export interface AttemptWorkspaceProps {
  attempt: Attempt;
  bank: StoredBank;
  settings: AppSettings;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onExit: () => void;
  onNewAttempt: () => void;
  onOpenBanks: () => void;
  /** Whether to open straight into review (an already-completed attempt). */
  initialView?: 'exam' | 'review';
  /** Hand a rebuilt attempt back to the host so it can remount this workspace. */
  onReplaceAttempt: (attempt: Attempt) => void;
  progress: (attempt: Attempt) => Pick<
    SettingsDialogProps,
    'onExportProgress' | 'onExportPortable' | 'onImportProgress' | 'importMessage'
  >;
}

/**
 * Owns the live attempt for one bank and switches between taking the exam and
 * reviewing it. Keeping the engine here means both views read the same state.
 */
export function AttemptWorkspace({
  attempt,
  bank,
  settings,
  onSettingsChange,
  onExit,
  onNewAttempt,
  onOpenBanks,
  initialView = 'exam',
  onReplaceAttempt,
  progress,
}: AttemptWorkspaceProps) {
  const engine = useAttemptEngine(attempt, bank.bank);
  const [view, setView] = useState<'exam' | 'review'>(initialView);

  const clearAttempt = useCallback(() => {
    const { completedAt: _completedAt, ...rest } = engine.attempt;
    const cleared: Attempt = {
      ...rest,
      responses: Object.fromEntries(
        engine.attempt.questionOrder.map((id) => [id, emptyResponse()]),
      ),
      currentQuestionId: engine.attempt.questionOrder[0] as string,
      updatedAt: new Date().toISOString(),
    };
    void saveAttempt(cleared).then(() => {
      setView('exam');
      onReplaceAttempt(cleared);
    });
  }, [engine.attempt, onReplaceAttempt]);

  const progressHandlers = progress(engine.attempt);

  if (view === 'review') {
    return (
      <ReviewScreen
        attempt={engine.attempt}
        questions={engine.questions}
        onOpenQuestion={(questionId) => {
          engine.dispatch({ type: 'navigate', questionId });
          setView('exam');
        }}
        onExit={onExit}
        onNewAttempt={onNewAttempt}
        onExportProgress={progressHandlers.onExportProgress}
      />
    );
  }

  return (
    <ExamScreen
      engine={engine}
      bank={bank.bank}
      settings={settings}
      onSettingsChange={onSettingsChange}
      onFinished={() => setView('review')}
      onExit={onExit}
      onOpenBanks={onOpenBanks}
      onClearAttempt={clearAttempt}
      progress={progressHandlers}
    />
  );
}
