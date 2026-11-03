/**
 * タイマーの「プログラム」定義。
 *
 * 通常のタイマーも「ステップ1つ × 1ラウンド」のプログラムとして扱うことで、
 * 単発タイマーとインターバルタイマーを同じエンジンで動かす。
 */

import { DEFAULT_LAP, type LapUnit } from './laps';

export type StepKind = 'work' | 'rest' | 'prepare';

export interface Step {
  id: string;
  /** 画面表示・読み上げに使う名前（例: 「ワーク」「休憩」） */
  label: string;
  kind: StepKind;
  durationSec: number;
}

export interface Program {
  id: string;
  name: string;
  /** 1ラウンド分のステップ列（例: 1分 → 30秒） */
  steps: Step[];
  /** 何ラウンド繰り返すか */
  rounds: number;
  /** 開始前の準備カウント（秒）。0 なら無し */
  prepareSec: number;
  /** 最終ラウンドの末尾にある休憩ステップを省略するか */
  skipLastRest: boolean;
  /** ダイヤル1周が表す範囲（未指定なら1ラウンドごと） */
  lap?: LapUnit;
}

export const programLap = (p: Program): LapUnit => p.lap ?? DEFAULT_LAP;

/** エンジンが実際に進める1区間 */
export interface Segment {
  index: number;
  label: string;
  kind: StepKind;
  durationMs: number;
  /** プログラム開始からこの区間が始まるまでの経過ms */
  startMs: number;
  /** 1始まりのラウンド番号（準備区間は 0） */
  round: number;
  totalRounds: number;
  /** ラウンド内のステップ番号（0始まり、準備区間は -1） */
  stepIndex: number;
}

let idCounter = 0;
export function newId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function makeStep(label: string, durationSec: number, kind: StepKind = 'work'): Step {
  return { id: newId('step'), label, kind, durationSec };
}

/** 単発タイマー用のプログラムを作る */
export function simpleProgram(durationSec: number, name?: string): Program {
  return {
    id: newId('prog'),
    name: name ?? 'タイマー',
    steps: [makeStep('タイマー', durationSec, 'work')],
    rounds: 1,
    prepareSec: 0,
    skipLastRest: false,
  };
}

/** ワーク/休憩を繰り返すインターバルプログラムを作る */
export function intervalProgram(
  workSec: number,
  restSec: number,
  rounds: number,
  opts: Partial<Pick<Program, 'name' | 'prepareSec' | 'skipLastRest'>> = {},
): Program {
  const steps = [makeStep('ワーク', workSec, 'work')];
  if (restSec > 0) steps.push(makeStep('休憩', restSec, 'rest'));
  return {
    id: newId('prog'),
    name: opts.name ?? 'インターバル',
    steps,
    rounds: Math.max(1, Math.floor(rounds)),
    prepareSec: opts.prepareSec ?? 0,
    // ×N は「ワーク+休憩」を N 回。最後の休憩も残すのが既定（ダイヤルでワーク同士が隣り合わないように）
    skipLastRest: opts.skipLastRest ?? false,
  };
}

export function isSimple(program: Program): boolean {
  return program.steps.length === 1 && program.rounds === 1 && program.prepareSec === 0;
}

/** プログラムをエンジンが進める区間の列に展開する */
export function buildSegments(program: Program): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  const rounds = Math.max(1, Math.floor(program.rounds));
  const push = (s: Omit<Segment, 'index' | 'startMs' | 'totalRounds'>) => {
    if (s.durationMs <= 0) return;
    segments.push({ ...s, index: segments.length, startMs: cursor, totalRounds: rounds });
    cursor += s.durationMs;
  };

  if (program.prepareSec > 0) {
    push({ label: '準備', kind: 'prepare', durationMs: program.prepareSec * 1000, round: 0, stepIndex: -1 });
  }

  // 末尾の休憩を省略する場合、最後の「休憩以外」のステップ位置を求める
  let lastNonRest = program.steps.length - 1;
  if (program.skipLastRest) {
    while (lastNonRest >= 0 && program.steps[lastNonRest].kind === 'rest') lastNonRest -= 1;
  }

  for (let r = 1; r <= rounds; r += 1) {
    program.steps.forEach((step, i) => {
      if (r === rounds && program.skipLastRest && i > lastNonRest) return;
      push({
        label: step.label,
        kind: step.kind,
        durationMs: Math.round(step.durationSec * 1000),
        round: r,
        stepIndex: i,
      });
    });
  }
  return segments;
}

export function totalDurationMs(segments: Segment[]): number {
  const last = segments[segments.length - 1];
  return last ? last.startMs + last.durationMs : 0;
}
