import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom does not implement ResizeObserver, which the question rail uses to
// size its virtualized window.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// jsdom implements neither of these, and the editor's download fallback uses
// them. Stubbing keeps that code path testable.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:stub';
  URL.revokeObjectURL = () => undefined;
}
