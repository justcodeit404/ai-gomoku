export {};

declare global {
  interface EngineProbeResult {
    binary: string | null;
    bundled: boolean;
    kind: 'rapfi' | string;
  }

  interface EngineMoveResult {
    x: number;
    y: number;
    role: number;
  }

  interface EngineHistoryMove {
    i?: number;
    j?: number;
    x?: number;
    y?: number;
    role: number;
  }

  interface EngineAPI {
    probe: () => Promise<EngineProbeResult & { ok?: boolean }>;
    start: (opts: Record<string, unknown>) => Promise<{ ok: boolean; firstMove?: EngineMoveResult | null; error?: string }>;
    move: (
      x: number,
      y: number,
      history?: EngineHistoryMove[],
    ) => Promise<{ ok: boolean; move?: EngineMoveResult; error?: string }>;
    undo: (
      steps?: number,
      history?: EngineHistoryMove[],
    ) => Promise<{ ok: boolean; popped?: unknown; error?: string }>;
    hint: (
      opts: Record<string, unknown>,
      history?: Array<{ x: number; y: number; role: number }>,
    ) => Promise<{ ok: boolean; move?: { x: number; y: number }; error?: string }>;
    setupBoard: (
      history: Array<{ x: number; y: number; role: number }>,
      nextPlayer: number,
    ) => Promise<{
      ok: boolean;
      aiMove?: EngineMoveResult | null;
      sentinelPos?: { x: number; y: number };
      aiTriggerReady?: boolean;
      error?: string;
    }>;
    triggerAiMoveAfterSetup: (
      sentinelPos: { x: number; y: number },
    ) => Promise<{ ok: boolean; aiMove?: EngineMoveResult; error?: string }>;
    end: () => Promise<{ ok: boolean; error?: string }>;
  }

  interface AppAPI {
    saveRecord: (content: string, defaultName?: string) => Promise<{ canceled?: boolean; path?: string }>;
    historyList: () => Promise<{ records?: unknown[] }>;
    historyAdd: (record: unknown) => Promise<{ count?: number }>;
    historyDelete: (id: string) => Promise<{ count?: number }>;
  }

  interface Window {
    engineAPI?: EngineAPI;
    appAPI?: AppAPI;
  }
}
