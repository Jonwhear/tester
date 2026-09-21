import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  CircleHelp,
  FlagTriangleRight,
  ListOrdered,
  PencilLine,
  Settings as SettingsIcon,
  TestTube,
} from 'lucide-react';

import { cn } from '../../utils/cn';
import type { ToolbarExtension } from './toolbarExtensions';

export type ToolId = 'tutorial' | 'labs' | 'notes' | 'calculator' | 'settings' | 'finish';

export interface ExamToolbarProps {
  itemIndex: number;
  itemCount: number;
  questionId: string;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onTool: (tool: ToolId) => void;
  activeTool?: ToolId | null;
  hasNotes: boolean;
  completed: boolean;
  onToggleRail: () => void;
  railId: string;
  railOpen: boolean;
  extensions?: ToolbarExtension[];
}

interface ToolButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolButton({ label, active, disabled, title, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={cn('toolitem', active && 'toolitem--active', disabled && 'toolitem--disabled')}
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled || undefined}
      aria-pressed={active ?? undefined}
      title={title ?? label}
    >
      {children}
      <span className="toolitem__label">{label}</span>
      <span className="sr-only">{title ?? label}</span>
    </button>
  );
}

/** Restrained top toolbar: item identity, position, navigation and tools. */
export function ExamToolbar({
  itemIndex,
  itemCount,
  questionId,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onTool,
  activeTool,
  hasNotes,
  completed,
  onToggleRail,
  railId,
  railOpen,
  extensions = [],
}: ExamToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar__left">
        <button
          type="button"
          className="toolitem rail-toggle"
          onClick={onToggleRail}
          aria-expanded={railOpen}
          aria-controls={railId}
        >
          <ListOrdered size={20} aria-hidden="true" />
          <span className="sr-only">
            {railOpen ? 'Hide question status list' : 'Show question status list'}
          </span>
        </button>
        <div className="item-box">
          <div>
            Item: {itemIndex + 1} of {itemCount}
          </div>
          <div className="item-box__id">Question Id: {questionId}</div>
        </div>
      </div>

      <div className="toolbar__center">
        <button
          type="button"
          className="navbtn"
          onClick={onPrevious}
          disabled={!canPrevious}
          title="Previous question (Left arrow)"
        >
          <span className="navbtn__icon">
            <ArrowLeft size={18} aria-hidden="true" />
          </span>
          <span className="navbtn__label">Previous</span>
          <span className="sr-only">Previous question</span>
        </button>

        <div className="toolbar__counter" aria-live="polite">
          {itemIndex + 1} / {itemCount}
        </div>

        <button
          type="button"
          className="navbtn"
          onClick={onNext}
          disabled={!canNext}
          title="Next question (Right arrow)"
        >
          <span className="navbtn__icon">
            <ArrowRight size={18} aria-hidden="true" />
          </span>
          <span className="navbtn__label">Next</span>
          <span className="sr-only">Next question</span>
        </button>
      </div>

      <div className="toolbar__right">
        {extensions.map((extension) => (
          <ToolButton
            key={extension.id}
            label={extension.label}
            disabled={extension.disabled}
            title={extension.description ?? extension.label}
            onClick={extension.onSelect}
          >
            <extension.icon size={20} aria-hidden={true} />
          </ToolButton>
        ))}

        <ToolButton
          label="Tutorial"
          active={activeTool === 'tutorial'}
          onClick={() => onTool('tutorial')}
          title="Help and keyboard shortcuts"
        >
          <CircleHelp size={20} aria-hidden="true" />
        </ToolButton>

        <ToolButton
          label="Lab Values"
          active={activeTool === 'labs'}
          onClick={() => onTool('labs')}
          title="Reference laboratory values"
        >
          <TestTube size={20} aria-hidden="true" />
        </ToolButton>

        <ToolButton
          label="Notes"
          active={activeTool === 'notes'}
          onClick={() => onTool('notes')}
          title={hasNotes ? 'Notes for this question (has content)' : 'Notes for this question'}
        >
          <PencilLine size={20} aria-hidden="true" />
        </ToolButton>

        <ToolButton
          label="Calculator"
          active={activeTool === 'calculator'}
          onClick={() => onTool('calculator')}
        >
          <Calculator size={20} aria-hidden="true" />
        </ToolButton>

        <ToolButton
          label="Settings"
          active={activeTool === 'settings'}
          onClick={() => onTool('settings')}
        >
          <SettingsIcon size={20} aria-hidden="true" />
        </ToolButton>

        {!completed ? (
          <ToolButton
            label="Finish"
            active={activeTool === 'finish'}
            onClick={() => onTool('finish')}
            title="Finish and submit this attempt"
          >
            <FlagTriangleRight size={20} aria-hidden="true" />
          </ToolButton>
        ) : null}
      </div>
    </header>
  );
}
