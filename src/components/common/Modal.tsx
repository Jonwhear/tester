import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { cn } from '../../utils/cn';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'narrow' | 'default' | 'wide';
  /** Render as a right-hand drawer instead of a centred dialog. */
  variant?: 'dialog' | 'drawer';
  /** Element to focus once the dialog opens. */
  initialFocusRef?: React.RefObject<HTMLElement>;
}

/**
 * Accessible modal: renders in a portal, traps Tab within itself, closes on
 * Escape or overlay click, and restores focus to whatever opened it.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'default',
  variant = 'dialog',
  initialFocusRef,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const target =
      initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    target?.focus();
    return () => restoreRef.current?.focus?.();
  }, [open, initialFocusRef]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!open) return null;

  const panel = (
    <div
      ref={panelRef}
      className={cn(
        variant === 'drawer' ? 'drawer' : 'dialog',
        variant === 'dialog' && size === 'wide' && 'dialog--wide',
        variant === 'dialog' && size === 'narrow' && 'dialog--narrow',
      )}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="dialog__header">
        <h2 className="dialog__title">{title}</h2>
        <button type="button" className="dialog__close" onClick={onClose}>
          <X size={15} aria-hidden="true" />
          <span className="sr-only">Close {title}</span>
        </button>
      </div>
      <div className={variant === 'drawer' ? 'drawer__body' : 'dialog__body'}>{children}</div>
      {footer ? <div className="dialog__footer">{footer}</div> : null}
    </div>
  );

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
      style={variant === 'drawer' ? { padding: 0, display: 'block' } : undefined}
    >
      {panel}
    </div>,
    document.body,
  );
}
