interface Props {
  value: number;
  onChange(sec: number): void;
  label?: string;
}

const clampInt = (v: string, max: number) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
};

/** 分・秒の入力 */
export function DurationInput({ value, onChange, label }: Props) {
  const m = Math.floor(value / 60);
  const s = value % 60;
  return (
    <div className="duration-input" aria-label={label}>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={999}
        value={m}
        onChange={(e) => onChange(clampInt(e.target.value, 999) * 60 + s)}
        aria-label={`${label ?? ''}分`}
      />
      <span>分</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={59}
        step={5}
        value={s}
        onChange={(e) => onChange(m * 60 + clampInt(e.target.value, 59))}
        aria-label={`${label ?? ''}秒`}
      />
      <span>秒</span>
    </div>
  );
}
