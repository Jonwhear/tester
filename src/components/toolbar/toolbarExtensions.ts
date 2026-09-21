import type { ComponentType } from 'react';

/**
 * Extension point for optional toolbar tools.
 *
 * The reference application carries an "Ask" tool backed by a remote service.
 * That is deliberately NOT implemented here: the exam engine must not depend on
 * a network service, and a visible control that does nothing is worse than no
 * control. Instead, a host can supply extra tools:
 *
 *   <ExamScreen toolbarExtensions={[{ id: 'ask', label: 'Ask', icon: Sparkles,
 *                                     onSelect: openAskPanel }]} />
 *
 * Anything passed in renders with the same density and styling as the built-in
 * tools. Nothing is rendered when the list is empty, which is the default.
 */
export interface ToolbarExtension {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number | string; 'aria-hidden'?: boolean }>;
  onSelect: () => void;
  /** Rendered dimmed and non-interactive, e.g. while a backend is unavailable. */
  disabled?: boolean;
  /** Tooltip / accessible description. */
  description?: string;
}

export const NO_TOOLBAR_EXTENSIONS: ToolbarExtension[] = [];
