/**
 * Saving to a real file on disk.
 *
 * Chromium browsers expose the File System Access API, which lets the editor
 * keep a handle to the file the user opened and write straight back to it —
 * so "Save" means Save, not "download another copy into Downloads". Firefox
 * and Safari do not support it, so every entry point here falls back to a
 * normal download and the UI is expected to say which one it used.
 *
 * The API is declared locally rather than relying on the installed DOM lib,
 * so this compiles the same way regardless of TypeScript's bundled types.
 */

interface WritableStreamLike {
  write(data: string | BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
}

export interface FileHandleLike {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableStreamLike>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface PickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface FilePickerWindow {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: PickerAcceptType[];
    excludeAcceptAllOption?: boolean;
  }) => Promise<FileHandleLike[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: PickerAcceptType[];
    excludeAcceptAllOption?: boolean;
  }) => Promise<FileHandleLike>;
}

const JSON_TYPES: PickerAcceptType[] = [
  { description: 'Question bank JSON', accept: { 'application/json': ['.json'] } },
];

function picker(): FilePickerWindow {
  return globalThis as unknown as FilePickerWindow;
}

/** True when this browser can write back to a file the user picked. */
export function supportsFileSystemAccess(): boolean {
  const api = picker();
  return typeof api.showOpenFilePicker === 'function' && typeof api.showSaveFilePicker === 'function';
}

/** Thrown-but-expected: the user dismissed the OS file dialog. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export interface OpenedFile {
  file: File;
  /** Present only when the browser supports writing back. */
  handle?: FileHandleLike;
}

/**
 * Open a JSON file, keeping a write handle where the browser allows it.
 * Returns null if the user cancelled.
 */
export async function openJsonFile(): Promise<OpenedFile | null> {
  const api = picker();
  if (!api.showOpenFilePicker) return null;
  try {
    const [handle] = await api.showOpenFilePicker({
      multiple: false,
      types: JSON_TYPES,
      excludeAcceptAllOption: false,
    });
    if (!handle) return null;
    return { file: await handle.getFile(), handle };
  } catch (error) {
    if (isAbortError(error)) return null;
    throw error;
  }
}

/** Ask for a save location. Returns null if the user cancelled or it is unsupported. */
export async function chooseSaveFile(suggestedName: string): Promise<FileHandleLike | null> {
  const api = picker();
  if (!api.showSaveFilePicker) return null;
  try {
    return await api.showSaveFilePicker({
      suggestedName,
      types: JSON_TYPES,
      excludeAcceptAllOption: false,
    });
  } catch (error) {
    if (isAbortError(error)) return null;
    throw error;
  }
}

/**
 * Re-acquire write permission on a handle.
 *
 * A handle kept across a page reload starts read-only; the browser requires a
 * user gesture to restore write access.
 */
export async function ensureWritePermission(handle: FileHandleLike): Promise<boolean> {
  const descriptor = { mode: 'readwrite' as const };
  if (handle.queryPermission) {
    const current = await handle.queryPermission(descriptor);
    if (current === 'granted') return true;
  }
  if (handle.requestPermission) {
    return (await handle.requestPermission(descriptor)) === 'granted';
  }
  // No permission API: assume the handle is usable and let the write report failure.
  return true;
}

/** Write text through a file handle, replacing the file's contents. */
export async function writeToHandle(handle: FileHandleLike, contents: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(contents);
  } finally {
    await writable.close();
  }
}
