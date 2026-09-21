import { useCallback, useState } from 'react';

import { Modal } from '../common/Modal';

export interface CalculatorDialogProps {
  open: boolean;
  onClose: () => void;
}

type Operator = '+' | '-' | '×' | '÷';

interface CalcState {
  /** Digits currently being typed. */
  entry: string;
  /** Left-hand accumulator, or null before the first operator. */
  accumulator: number | null;
  pending: Operator | null;
  /** True when `entry` is a result rather than user input. */
  replaceEntry: boolean;
  expression: string;
}

const INITIAL: CalcState = {
  entry: '0',
  accumulator: null,
  pending: null,
  replaceEntry: true,
  expression: '',
};

function compute(left: number, operator: Operator, right: number): number {
  switch (operator) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '×':
      return left * right;
    case '÷':
      return right === 0 ? NaN : left / right;
    default:
      return right;
  }
}

function format(value: number): string {
  if (!Number.isFinite(value)) return 'Error';
  // Trim float noise without losing genuine precision.
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded);
}

/** Compact four-function calculator. No network, no external dependency. */
export function CalculatorDialog({ open, onClose }: CalculatorDialogProps) {
  const [state, setState] = useState<CalcState>(INITIAL);

  const digit = useCallback((char: string) => {
    setState((s) => {
      if (char === '.' ) {
        if (!s.replaceEntry && s.entry.includes('.')) return s;
        return { ...s, entry: s.replaceEntry ? '0.' : `${s.entry}.`, replaceEntry: false };
      }
      const entry = s.replaceEntry || s.entry === '0' ? char : `${s.entry}${char}`;
      return { ...s, entry, replaceEntry: false };
    });
  }, []);

  const operator = useCallback((op: Operator) => {
    setState((s) => {
      const current = Number(s.entry);
      if (s.pending !== null && s.accumulator !== null && !s.replaceEntry) {
        const result = compute(s.accumulator, s.pending, current);
        return {
          entry: format(result),
          accumulator: result,
          pending: op,
          replaceEntry: true,
          expression: `${format(result)} ${op}`,
        };
      }
      return {
        ...s,
        accumulator: current,
        pending: op,
        replaceEntry: true,
        expression: `${s.entry} ${op}`,
      };
    });
  }, []);

  const equals = useCallback(() => {
    setState((s) => {
      if (s.pending === null || s.accumulator === null) return s;
      const right = Number(s.entry);
      const result = compute(s.accumulator, s.pending, right);
      return {
        entry: format(result),
        accumulator: null,
        pending: null,
        replaceEntry: true,
        expression: `${format(s.accumulator)} ${s.pending} ${format(right)} =`,
      };
    });
  }, []);

  const clear = useCallback(() => setState(INITIAL), []);

  const backspace = useCallback(() => {
    setState((s) => {
      if (s.replaceEntry) return s;
      const entry = s.entry.length <= 1 ? '0' : s.entry.slice(0, -1);
      return { ...s, entry, replaceEntry: entry === '0' };
    });
  }, []);

  const keys: Array<{ label: string; onPress: () => void; className?: string; srLabel?: string }> = [
    { label: 'C', onPress: clear, className: 'calc__key--op', srLabel: 'Clear' },
    { label: '⌫', onPress: backspace, className: 'calc__key--op', srLabel: 'Backspace' },
    { label: '÷', onPress: () => operator('÷'), className: 'calc__key--op', srLabel: 'Divide' },
    { label: '×', onPress: () => operator('×'), className: 'calc__key--op', srLabel: 'Multiply' },
    { label: '7', onPress: () => digit('7') },
    { label: '8', onPress: () => digit('8') },
    { label: '9', onPress: () => digit('9') },
    { label: '-', onPress: () => operator('-'), className: 'calc__key--op', srLabel: 'Subtract' },
    { label: '4', onPress: () => digit('4') },
    { label: '5', onPress: () => digit('5') },
    { label: '6', onPress: () => digit('6') },
    { label: '+', onPress: () => operator('+'), className: 'calc__key--op', srLabel: 'Add' },
    { label: '1', onPress: () => digit('1') },
    { label: '2', onPress: () => digit('2') },
    { label: '3', onPress: () => digit('3') },
    { label: '=', onPress: equals, className: 'calc__key--equals', srLabel: 'Equals' },
    { label: '0', onPress: () => digit('0') },
    { label: '.', onPress: () => digit('.'), srLabel: 'Decimal point' },
  ];

  return (
    <Modal open={open} title="Calculator" onClose={onClose} size="narrow">
      <div className="calc">
        <div className="calc__display" role="status" aria-live="polite">
          <span className="calc__expr">{state.expression}</span>
          {state.entry}
        </div>
        <div className="calc__grid">
          {keys.map((key, index) => (
            <button
              key={key.label + index}
              type="button"
              className={`calc__key ${key.className ?? ''}`}
              onClick={key.onPress}
              style={key.label === '0' ? { gridColumn: 'span 2' } : undefined}
            >
              <span aria-hidden="true">{key.label}</span>
              <span className="sr-only">{key.srLabel ?? key.label}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
