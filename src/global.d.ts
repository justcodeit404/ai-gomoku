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

  interface EngineAPI {
    probe: () => Promise<EngineProbeResult>;
    start: (opts: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
    begin: () => Promise<EngineMoveResult>;
    move: (x: number, y: number, history?: Array<{ i: number; j: number; role: number }>) => Promise<{ ok: boolean; move?: EngineMoveResult; error?: string }>;
    undo: (steps?: number) => Promise<{ ok: boolean; error?: string }>;
    stop: () => Promise<{ ok: boolean; error?: string }>;
    forbid: () => Promise<{ ok: boolean; points?: Array<{ x: number; y: number }>; error?: string }>;
    end: () => Promise<{ ok: boolean; error?: string }>;
    on: (handler: (event: unknown, payload: unknown) => void) => () => void;
  }

  interface Window {
    engineAPI?: EngineAPI;
  }
}
