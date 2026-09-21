import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Attempt } from '../types/attempt';
import type { StoredBank } from '../types/question';
import { SAMPLE_BANK } from '../sample-data';
import { createAttempt, checkAttemptCompatibility } from '../state/attemptFactory';
import {
  getBank,
  listBanks,
  loadActiveAttemptId,
  loadAttempt,
  saveActiveAttemptId,
  saveAttempt,
  saveBank,
} from '../storage/repositories';
import {
  buildPortableSession,
  buildProgressFile,
  parseProgressFile,
} from '../storage/exportImport';
import { useSettings } from '../hooks/useSettings';
import { downloadJson, readFileAsText, timestampSlug } from '../utils/download';
import { StartScreen } from '../components/start/StartScreen';
import { NewAttemptDialog } from '../components/start/NewAttemptDialog';
import { BankManagerScreen } from '../components/dialogs/BankManagerScreen';
import { AttemptHistoryScreen } from '../components/review/AttemptHistoryScreen';
import { SettingsDialog } from '../components/dialogs/SettingsDialog';
import { AttemptWorkspace } from './AttemptWorkspace';

type View = 'start' | 'attempt' | 'banks' | 'history';

interface ActiveSession {
  attempt: Attempt;
  bank: StoredBank;
  view: 'exam' | 'review';
  /** Bumped to remount the workspace with a rebuilt attempt. */
  key: number;
}

type ImportMessage = { level: 'ok' | 'warn' | 'error'; text: string } | null;

export function App() {
  const { settings, updateSettings, settingsLoaded } = useSettings();

  const [view, setView] = useState<View>('start');
  const [banks, setBanks] = useState<StoredBank[]>([]);
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [resumable, setResumable] = useState<Attempt | null>(null);
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [newAttemptOpen, setNewAttemptOpen] = useState(false);
  const [startSettingsOpen, setStartSettingsOpen] = useState(false);
  const [importMessage, setImportMessage] = useState<ImportMessage>(null);

  const refreshBanks = useCallback(async () => {
    const stored = await listBanks();
    setBanks(stored);
    return stored;
  }, []);

  /* ---------------- boot ---------------- */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        let stored = await listBanks();
        // First run: install the bundled fixture so the app is usable immediately.
        if (stored.length === 0) {
          await saveBank(SAMPLE_BANK, true);
          stored = await listBanks();
        }
        if (cancelled) return;
        setBanks(stored);

        const activeId = await loadActiveAttemptId();
        if (activeId) {
          const attempt = await loadAttempt(activeId);
          if (attempt && !cancelled) setResumable(attempt);
        }
      } catch (error) {
        if (!cancelled) {
          setBootError(
            error instanceof Error
              ? `Local storage is unavailable: ${error.message}`
              : 'Local storage is unavailable.',
          );
        }
      } finally {
        if (!cancelled) setBooted(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const totalQuestions = useMemo(
    () => banks.reduce((sum, bank) => sum + bank.questionCount, 0),
    [banks],
  );

  /* ---------------- opening attempts ---------------- */

  const openAttempt = useCallback(
    async (attempt: Attempt, preferredView?: 'exam' | 'review') => {
      const stored = await getBank(attempt.bankId, attempt.bankVersion);
      const report = checkAttemptCompatibility(attempt, stored);
      if (report.level === 'error' || !stored) {
        setBootError(report.messages.join(' '));
        setView('start');
        return;
      }
      if (report.level === 'warning') {
        setImportMessage({ level: 'warn', text: report.messages.join(' ') });
      }
      await saveActiveAttemptId(attempt.attemptId);
      setBootError(null);
      setSession({
        attempt,
        bank: stored,
        view: preferredView ?? (attempt.completedAt ? 'review' : 'exam'),
        key: Date.now(),
      });
      setView('attempt');
    },
    [],
  );

  const exitToStart = useCallback(async () => {
    setSession(null);
    setView('start');
    const activeId = await loadActiveAttemptId();
    if (activeId) {
      const attempt = await loadAttempt(activeId);
      setResumable(attempt ?? null);
    } else {
      setResumable(null);
    }
    await refreshBanks();
  }, [refreshBanks]);

  /* ---------------- progress export / import ---------------- */

  const progressHandlers = useCallback(
    (attempt: Attempt) => ({
      onExportProgress: () => {
        const bank = session?.bank;
        if (!bank) return;
        downloadJson(
          `progress-${attempt.bankId}-${timestampSlug()}.json`,
          buildProgressFile(bank, [attempt]),
        );
      },
      onExportPortable: () => {
        const bank = session?.bank;
        if (!bank) return;
        downloadJson(
          `session-${attempt.bankId}-${timestampSlug()}.json`,
          buildPortableSession(bank.bank, [attempt]),
        );
      },
      onImportProgress: (file: File) => {
        void importProgressFile(file);
      },
      importMessage,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, importMessage],
  );

  const importProgressFile = useCallback(
    async (file: File) => {
      setImportMessage(null);
      let payload: unknown;
      try {
        payload = JSON.parse(await readFileAsText(file));
      } catch (error) {
        setImportMessage({
          level: 'error',
          text:
            error instanceof SyntaxError
              ? `${file.name} is not valid JSON.`
              : `Could not read ${file.name}.`,
        });
        return;
      }

      const outcome = parseProgressFile(payload);
      if (!outcome.ok) {
        setImportMessage({ level: 'error', text: outcome.errors.slice(0, 4).join(' · ') });
        return;
      }

      const parsed = outcome.parsed;

      // A portable session carries its bank; install it if it is missing.
      if (parsed.bank && !(await getBank(parsed.bankId, parsed.bankVersion))) {
        await saveBank(parsed.bank);
        await refreshBanks();
      }

      const stored = await getBank(parsed.bankId, parsed.bankVersion);
      const accepted: Attempt[] = [];
      const rejected: string[] = [];
      let warned: string | null = null;

      for (const attempt of parsed.attempts) {
        const report = checkAttemptCompatibility(attempt, stored);
        if (report.level === 'error') {
          rejected.push(report.messages.join(' '));
          continue;
        }
        if (report.level === 'warning') warned = report.messages.join(' ');
        await saveAttempt(attempt);
        accepted.push(attempt);
      }

      if (accepted.length === 0) {
        setImportMessage({
          level: 'error',
          text: `Nothing was imported. ${rejected[0] ?? 'No compatible attempts in the file.'}`,
        });
        return;
      }

      const last = accepted[accepted.length - 1] as Attempt;
      await saveActiveAttemptId(last.attemptId);
      setResumable(last);
      setImportMessage({
        level: warned ? 'warn' : 'ok',
        text:
          `Imported ${accepted.length} attempt${accepted.length === 1 ? '' : 's'}` +
          (rejected.length > 0 ? `; ${rejected.length} rejected as incompatible.` : '.') +
          (warned ? ` ${warned}` : ''),
      });
    },
    [refreshBanks],
  );

  /* ---------------- render ---------------- */

  if (!booted || !settingsLoaded) {
    return (
      <div className="start">
        <div className="start__panel">
          <div className="start__header">
            <h1 className="start__app">Question Bank — Examination</h1>
            <p className="start__meta">Loading local data…</p>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'banks') {
    return (
      <BankManagerScreen
        onBack={() => {
          setView(session ? 'attempt' : 'start');
          void refreshBanks();
        }}
        onBanksChanged={() => void refreshBanks()}
      />
    );
  }

  if (view === 'history') {
    return (
      <AttemptHistoryScreen
        onBack={() => setView('start')}
        onOpenReview={(attemptId) => {
          void loadAttempt(attemptId).then((attempt) => {
            if (attempt) void openAttempt(attempt);
          });
        }}
      />
    );
  }

  if (view === 'attempt' && session) {
    return (
      <AttemptWorkspace
        key={session.key}
        attempt={session.attempt}
        bank={session.bank}
        settings={settings}
        onSettingsChange={updateSettings}
        initialView={session.view}
        onExit={() => void exitToStart()}
        onNewAttempt={() => {
          void exitToStart().then(() => setNewAttemptOpen(true));
        }}
        onOpenBanks={() => setView('banks')}
        onReplaceAttempt={(attempt) =>
          setSession((current) =>
            current ? { ...current, attempt, view: 'exam', key: Date.now() } : current,
          )
        }
        progress={progressHandlers}
      />
    );
  }

  const resumeInfo = resumable
    ? {
        meta: (() => {
          const { responses: _responses, ...meta } = resumable;
          return meta;
        })(),
        itemIndex: Math.max(0, resumable.questionOrder.indexOf(resumable.currentQuestionId)),
        answered: Object.values(resumable.responses).filter((r) => r.selectedAnswers.length > 0)
          .length,
      }
    : null;

  return (
    <>
      <StartScreen
        bankCount={banks.length}
        questionCount={totalQuestions}
        activeAttempt={resumeInfo}
        onResume={() => {
          if (resumable) void openAttempt(resumable);
        }}
        onNewAttempt={() => setNewAttemptOpen(true)}
        onOpenBanks={() => setView('banks')}
        onOpenHistory={() => setView('history')}
        onOpenSettings={() => setStartSettingsOpen(true)}
        error={bootError}
      />

      <NewAttemptDialog
        open={newAttemptOpen}
        banks={banks}
        defaultMode={settings.mode}
        onCancel={() => setNewAttemptOpen(false)}
        onOpenBanks={() => {
          setNewAttemptOpen(false);
          setView('banks');
        }}
        onStart={({ bank, mode, range }) => {
          setNewAttemptOpen(false);
          const attempt = createAttempt(bank.bank, { mode, ...(range ? { range } : {}) });
          updateSettings({ mode });
          void saveAttempt(attempt)
            .then(() => saveActiveAttemptId(attempt.attemptId))
            .then(() => {
              setResumable(attempt);
              setSession({ attempt, bank, view: 'exam', key: Date.now() });
              setView('attempt');
            })
            .catch((error: unknown) =>
              setBootError(
                error instanceof Error ? error.message : 'Could not start a new attempt.',
              ),
            );
        }}
      />

      <SettingsDialog
        open={startSettingsOpen}
        settings={settings}
        onChange={updateSettings}
        onClose={() => setStartSettingsOpen(false)}
        onOpenBanks={() => {
          setStartSettingsOpen(false);
          setView('banks');
        }}
        onExportProgress={() => {
          if (!resumable) return;
          const bank = banks.find(
            (b) => b.bankId === resumable.bankId && b.bankVersion === resumable.bankVersion,
          );
          if (!bank) return;
          downloadJson(
            `progress-${resumable.bankId}-${timestampSlug()}.json`,
            buildProgressFile(bank, [resumable]),
          );
        }}
        onExportPortable={() => {
          if (!resumable) return;
          const bank = banks.find(
            (b) => b.bankId === resumable.bankId && b.bankVersion === resumable.bankVersion,
          );
          if (!bank) return;
          downloadJson(
            `session-${resumable.bankId}-${timestampSlug()}.json`,
            buildPortableSession(bank.bank, [resumable]),
          );
        }}
        onImportProgress={(file) => void importProgressFile(file)}
        importMessage={importMessage}
      />
    </>
  );
}
