import { useCallback, useId, useMemo, useState } from 'react';
import { Flag } from 'lucide-react';

import type { AppSettings } from '../../types/settings';
import type { TestingMode } from '../../types/attempt';
import type { QuestionBank } from '../../types/question';
import { hasAnswerKey, requiredSelectionCount, selectionIsComplete, summarizeAttempt } from '../../grading/grade';
import { correctnessVisible, revealContextFor } from '../../state/statusModel';
import type { AttemptEngine } from '../../hooks/useAttemptEngine';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { QuestionRail } from '../navigation/QuestionRail';
import { ExamToolbar, type ToolId } from '../toolbar/ExamToolbar';
import type { ToolbarExtension } from '../toolbar/toolbarExtensions';
import { CalculatorDialog } from '../dialogs/CalculatorDialog';
import { FinishDialog } from '../dialogs/FinishDialog';
import { HelpDialog } from '../dialogs/HelpDialog';
import { LabValuesDialog } from '../dialogs/LabValuesDialog';
import { NotesDialog } from '../dialogs/NotesDialog';
import { SettingsDialog, type SettingsDialogProps } from '../dialogs/SettingsDialog';
import { AnswerOptions } from './AnswerOptions';
import { QuestionContent } from './QuestionContent';
import { cn } from '../../utils/cn';

export interface ExamScreenProps {
  engine: AttemptEngine;
  bank: QuestionBank;
  settings: AppSettings;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onFinished: () => void;
  onExit: () => void;
  onOpenBanks: () => void;
  progress: Pick<
    SettingsDialogProps,
    'onExportProgress' | 'onExportPortable' | 'onImportProgress' | 'importMessage'
  >;
  onClearAttempt: () => void;
  /** Optional extra toolbar tools, e.g. a host-provided "Ask" panel. */
  toolbarExtensions?: ToolbarExtension[];
}

export function ExamScreen({
  engine,
  bank,
  settings,
  onSettingsChange,
  onFinished,
  onExit,
  onOpenBanks,
  progress,
  onClearAttempt,
  toolbarExtensions,
}: ExamScreenProps) {
  const { attempt, dispatch, currentQuestion, currentIndex, questions, currentLocked, saveError } =
    engine;
  const [tool, setTool] = useState<ToolId | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [localHighlights, setLocalHighlights] = useState(settings.suggestedHighlights);
  const railId = useId();

  const reveal = revealContextFor(attempt);
  const response = attempt.responses[attempt.currentQuestionId];
  const itemCount = attempt.questionOrder.length;

  const keyed = currentQuestion ? hasAnswerKey(currentQuestion) : false;
  const graded =
    response?.status === 'correct' || response?.status === 'incorrect' || Boolean(response?.ungradable && response?.gradedAt);
  const revealKey = Boolean(currentQuestion) && correctnessVisible(reveal) && (graded || Boolean(attempt.completedAt));

  const goTo = useCallback(
    (questionId: string) => {
      dispatch({ type: 'navigate', questionId });
      dispatch({ type: 'view', questionId });
      setRailOpen(false);
    },
    [dispatch],
  );

  const step = useCallback(
    (delta: number) => {
      const index = attempt.questionOrder.indexOf(attempt.currentQuestionId) + delta;
      const next = attempt.questionOrder[index];
      if (next) goTo(next);
    },
    [attempt.questionOrder, attempt.currentQuestionId, goTo],
  );

  const selectOption = useCallback(
    (label: string) => {
      if (!currentQuestion) return;
      const questionId = currentQuestion.id;
      dispatch({ type: 'selectOption', questionId, label });

      if (
        settings.autoAdvance &&
        currentQuestion.questionType === 'single' &&
        attempt.mode === 'tutor'
      ) {
        // Tutor single-select grades on selection, so advancing is safe once the
        // result has been shown. Exam mode advances immediately.
        window.setTimeout(() => step(1), 600);
      } else if (settings.autoAdvance && currentQuestion.questionType === 'single') {
        window.setTimeout(() => step(1), 120);
      }
    },
    [attempt.mode, currentQuestion, dispatch, settings.autoAdvance, step],
  );

  const chooseByKeyboard = useCallback(
    (label: string) => {
      if (!currentQuestion || currentLocked) return;
      const match = currentQuestion.options.find(
        (option) => option.label.trim().toUpperCase() === label,
      );
      if (match) selectOption(match.label);
    },
    [currentLocked, currentQuestion, selectOption],
  );

  const shortcutHandlers = useMemo(
    () => ({
      onPrevious: () => step(-1),
      onNext: () => step(1),
      onToggleMark: () => dispatch({ type: 'toggleMark', questionId: attempt.currentQuestionId }),
      onOpenNotes: () => setTool('notes'),
      onEscape: () => {
        setTool(null);
        setRailOpen(false);
      },
      onChooseOption: chooseByKeyboard,
    }),
    [attempt.currentQuestionId, chooseByKeyboard, dispatch, step],
  );

  useKeyboardShortcuts(settings.keyboardShortcuts && tool === null, shortcutHandlers);

  const summary = useMemo(() => summarizeAttempt(attempt, questions), [attempt, questions]);

  const showHighlights = localHighlights && Boolean(currentQuestion?.suggestedHighlights?.length);
  const required = currentQuestion ? requiredSelectionCount(currentQuestion) : undefined;
  const canCheck =
    currentQuestion !== undefined &&
    attempt.mode === 'tutor' &&
    !attempt.completedAt &&
    currentQuestion.questionType === 'multiple' &&
    !graded &&
    selectionIsComplete(currentQuestion, response?.selectedAnswers ?? []);

  return (
    <div className="exam-shell">
      <QuestionRail
        id={railId}
        questionOrder={attempt.questionOrder}
        responses={attempt.responses}
        currentQuestionId={attempt.currentQuestionId}
        reveal={reveal}
        onSelect={goTo}
        open={railOpen}
      />

      {railOpen ? (
        <button
          type="button"
          className="rail-scrim"
          onClick={() => setRailOpen(false)}
          aria-label="Close question status list"
        />
      ) : null}

      <div className="exam-main">
        <ExamToolbar
          itemIndex={currentIndex}
          itemCount={itemCount}
          questionId={attempt.currentQuestionId}
          canPrevious={currentIndex > 0}
          canNext={currentIndex < itemCount - 1}
          onPrevious={() => step(-1)}
          onNext={() => step(1)}
          onTool={(next) => setTool((previous) => (previous === next ? null : next))}
          activeTool={tool}
          hasNotes={Boolean(response?.notes)}
          completed={Boolean(attempt.completedAt)}
          onToggleRail={() => setRailOpen((open) => !open)}
          railId={railId}
          railOpen={railOpen}
          {...(toolbarExtensions ? { extensions: toolbarExtensions } : {})}
        />

        <main className="question-pane">
          <div className="question-pane__inner">
            {saveError ? (
              <p className="banner banner--error" style={{ marginBottom: 14 }}>
                Progress could not be saved: {saveError}
              </p>
            ) : null}

            {!currentQuestion ? (
              <p className="banner banner--error">
                Question <code>{attempt.currentQuestionId}</code> is not present in the loaded bank.
              </p>
            ) : (
              <>
                <div className="question-actions">
                  <label
                    className={cn('checkline', response?.marked && 'checkline--marked')}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(response?.marked)}
                      onChange={() =>
                        dispatch({ type: 'toggleMark', questionId: currentQuestion.id })
                      }
                    />
                    <span className="checkline__flag" aria-hidden="true">
                      <Flag size={15} />
                    </span>
                    Mark Question
                  </label>

                  {currentQuestion.suggestedHighlights?.length ? (
                    <label className="checkline">
                      <input
                        type="checkbox"
                        checked={localHighlights}
                        onChange={(event) => setLocalHighlights(event.target.checked)}
                      />
                      Suggested Highlights
                    </label>
                  ) : null}
                </div>

                <QuestionContent
                  question={currentQuestion}
                  showHighlights={showHighlights}
                  showReviewNote={settings.showReviewNotes}
                />

                <AnswerOptions
                  question={currentQuestion}
                  response={response ?? { selectedAnswers: [], status: 'unseen', marked: false }}
                  revealKey={revealKey}
                  locked={currentLocked}
                  onSelect={selectOption}
                  onToggleCrossOut={(label) =>
                    dispatch({ type: 'toggleCrossOut', questionId: currentQuestion.id, label })
                  }
                />

                <div className="answer-bar">
                  {canCheck ? (
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() =>
                        dispatch({ type: 'checkAnswer', questionId: currentQuestion.id })
                      }
                    >
                      Check Answer
                    </button>
                  ) : null}

                  {currentQuestion.questionType === 'multiple' &&
                  !graded &&
                  !attempt.completedAt &&
                  required !== undefined &&
                  (response?.selectedAnswers.length ?? 0) !== required ? (
                    <span className="answer-note">
                      Select {required} option{required === 1 ? '' : 's'} to continue.
                    </span>
                  ) : null}

                  {(response?.selectedAnswers.length ?? 0) > 0 && !currentLocked ? (
                    <button
                      type="button"
                      className="btn btn--quiet btn--sm"
                      onClick={() =>
                        dispatch({ type: 'clearSelection', questionId: currentQuestion.id })
                      }
                    >
                      Clear selection
                    </button>
                  ) : null}

                  {!keyed ? (
                    <span className="answer-note answer-note--warn">
                      No answer key for this item — it will be recorded but not graded.
                    </span>
                  ) : null}
                </div>

                {revealKey ? (
                  <section className="feedback" aria-label="Answer feedback">
                    <p
                      className={cn(
                        'feedback__verdict',
                        response?.status === 'correct' && 'feedback__verdict--correct',
                        response?.status === 'incorrect' && 'feedback__verdict--incorrect',
                        response?.ungradable && 'feedback__verdict--ungradable',
                      )}
                    >
                      {response?.status === 'correct'
                        ? 'Correct'
                        : response?.status === 'incorrect'
                          ? `Incorrect — correct answer: ${(currentQuestion.correctAnswer ?? []).join(', ')}`
                          : response?.ungradable
                            ? 'Answered — this item has no answer key, so it is not graded.'
                            : keyed
                              ? `Correct answer: ${(currentQuestion.correctAnswer ?? []).join(', ')}`
                              : 'This item has no answer key.'}
                    </p>

                    {currentQuestion.explanation ? (
                      <div className="feedback__section">
                        <h3 className="feedback__heading">Explanation</h3>
                        <p className="feedback__body">{currentQuestion.explanation}</p>
                      </div>
                    ) : null}

                    {currentQuestion.educationalObjective ? (
                      <div className="feedback__section">
                        <h3 className="feedback__heading">Educational objective</h3>
                        <p className="feedback__body">{currentQuestion.educationalObjective}</p>
                      </div>
                    ) : null}

                    {currentQuestion.references?.length ? (
                      <div className="feedback__section">
                        <h3 className="feedback__heading">References</h3>
                        <ul className="feedback__list">
                          {currentQuestion.references.map((reference) => (
                            <li key={reference}>{reference}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {attempt.completedAt ? (
                  <div className="answer-bar" style={{ marginTop: 22 }}>
                    <button type="button" className="btn btn--primary" onClick={onFinished}>
                      Back to review
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </main>
      </div>

      <NotesDialog
        open={tool === 'notes'}
        questionId={attempt.currentQuestionId}
        itemNumber={currentIndex + 1}
        notes={response?.notes ?? ''}
        onChange={(notes) =>
          dispatch({ type: 'setNotes', questionId: attempt.currentQuestionId, notes })
        }
        onClose={() => setTool(null)}
      />

      <LabValuesDialog open={tool === 'labs'} onClose={() => setTool(null)} />
      <CalculatorDialog open={tool === 'calculator'} onClose={() => setTool(null)} />
      <HelpDialog
        open={tool === 'tutorial'}
        onClose={() => setTool(null)}
        shortcutsEnabled={settings.keyboardShortcuts}
      />

      <SettingsDialog
        open={tool === 'settings'}
        settings={settings}
        onChange={(patch) => {
          onSettingsChange(patch);
          if (patch.suggestedHighlights !== undefined) setLocalHighlights(patch.suggestedHighlights);
        }}
        onClose={() => setTool(null)}
        attempt={{
          mode: attempt.mode,
          completed: Boolean(attempt.completedAt),
          onModeChange: (mode: TestingMode) => {
            dispatch({ type: 'setMode', mode });
            onSettingsChange({ mode });
          },
          onClear: () => {
            setTool(null);
            onClearAttempt();
          },
          onExit: () => {
            setTool(null);
            onExit();
          },
        }}
        onOpenBanks={() => {
          setTool(null);
          onOpenBanks();
        }}
        {...progress}
      />

      <FinishDialog
        open={tool === 'finish'}
        summary={summary}
        mode={attempt.mode}
        onClose={() => setTool(null)}
        onSubmit={() => {
          setTool(null);
          dispatch({ type: 'complete' });
          onFinished();
        }}
      />

      <p className="sr-only" aria-live="polite">
        {`Item ${currentIndex + 1} of ${itemCount}. Bank ${bank.title}.`}
      </p>
    </div>
  );
}
