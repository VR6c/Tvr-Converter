export type ToolMode =
  | 'select'
  | 'draw'
  | 'paint'
  | 'slice'
  | 'mute'
  | 'erase';

export type KeyLabelMode = 'all' | 'octaves' | 'scale' | 'none';

export interface ViewportRange {
  scrollX: number;
  pps: number;
  visibleDuration: number;
  totalDuration: number;
}

