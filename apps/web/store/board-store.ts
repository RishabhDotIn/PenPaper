import { create } from "zustand";

/**
 * Metadata about the open board, not the board itself.
 *
 * Elements stay inside the canvas engine on purpose: copying them into React
 * state would turn every stroke into an object graph diff. What the chrome
 * needs is small and changes rarely — whether the board has loaded, how many
 * elements are on it, and when it was last written to the device.
 */
export type BoardStatus = "loading" | "ready" | "unavailable";

export interface BoardStoreState {
  boardId: string | null;
  status: BoardStatus;
  elementCount: number;
  /** Epoch milliseconds of the last successful disk write. */
  savedAt: number | null;

  setBoard(boardId: string): void;
  setStatus(status: BoardStatus): void;
  setElementCount(count: number): void;
  markSaved(at: number): void;
  reset(): void;
}

const INITIAL = {
  boardId: null,
  status: "loading",
  elementCount: 0,
  savedAt: null,
} satisfies Pick<BoardStoreState, "boardId" | "status" | "elementCount" | "savedAt">;

export const useBoardStore = create<BoardStoreState>((set) => ({
  ...INITIAL,

  setBoard: (boardId) => set({ ...INITIAL, boardId }),
  setStatus: (status) => set({ status }),
  setElementCount: (elementCount) => set({ elementCount }),
  markSaved: (savedAt) => set({ savedAt }),
  reset: () => set({ ...INITIAL }),
}));
