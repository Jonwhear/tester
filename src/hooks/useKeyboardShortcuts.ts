import { useEffect } from 'react';

export interface ShortcutHandlers {
  onPrevious: () => void;
  onNext: () => void;
  onToggleMark: () => void;
  onOpenNotes: () => void;
  onEscape: () => void;
  /** Called with a normalized option label ("A".."Z"). */
  onChooseOption: (label: string) => void;
}

/** True when focus is inside a text field, where shortcuts must not fire. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    // Radios and checkboxes are answer controls, not text entry.
    return type !== 'radio' && type !== 'checkbox' && type !== 'button' && type !== 'submit';
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Global exam shortcuts.
 *
 * Deliberately inert while the user is typing, and while a modifier is held so
 * browser and OS chords keep working.
 */
export function useKeyboardShortcuts(enabled: boolean, handlers: ShortcutHandlers): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handlers.onEscape();
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          handlers.onPrevious();
          return;
        case 'ArrowRight':
          event.preventDefault();
          handlers.onNext();
          return;
        default:
          break;
      }

      if (event.key.length !== 1) return;
      const upper = event.key.toUpperCase();

      if (upper === 'M') {
        event.preventDefault();
        handlers.onToggleMark();
        return;
      }
      if (upper === 'N') {
        event.preventDefault();
        handlers.onOpenNotes();
        return;
      }
      if (upper >= 'A' && upper <= 'H') {
        event.preventDefault();
        handlers.onChooseOption(upper);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, handlers]);
}
