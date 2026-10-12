import type { ReactNode } from 'react';

import { SPORT_ICONS, type Sport } from '../lib/types';

export const SPORT_TEXT: Record<Sport, string> = {
  swim: 'text-swim',
  bike: 'text-bike',
  run: 'text-run',
  strength: 'text-strength',
  multi: 'text-white',
  rest: 'text-rest',
};

export const SPORT_BG: Record<Sport, string> = {
  swim: 'bg-swim',
  bike: 'bg-bike',
  run: 'bg-run',
  strength: 'bg-strength',
  multi: 'bg-white',
  rest: 'bg-rest',
};

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const base = `rounded-2xl bg-base-850 border border-base-700/60 ${className}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} w-full text-left active:opacity-70`}>
        {children}
      </button>
    );
  }
  return <div className={base}>{children}</div>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-run text-base-950 font-semibold active:bg-run/80 disabled:bg-base-700 disabled:text-faint',
  secondary: 'bg-base-800 text-white border border-base-600 active:bg-base-700 disabled:text-faint',
  ghost: 'text-muted active:text-white',
  danger: 'bg-red-500/15 text-red-300 border border-red-500/30 active:bg-red-500/25',
};

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  className = '',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-3 text-[15px] transition-colors disabled:opacity-60 ${BUTTON_STYLES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Screen({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="min-h-full px-4 pt-3 pb-28">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] leading-tight font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-6 mb-2 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
      {children}
    </h2>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] leading-snug text-faint">{hint}</span>}
    </label>
  );
}

const INPUT_CLASS =
  'w-full rounded-xl border border-base-600 bg-base-900 px-3.5 py-3 text-white placeholder:text-faint focus:border-run focus:outline-none';

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
}) {
  return (
    <input
      type={type}
      value={value}
      inputMode={inputMode}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={INPUT_CLASS}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`${INPUT_CLASS} resize-none`}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={`${INPUT_CLASS} appearance-none pr-10`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-faint">
        ▾
      </span>
    </div>
  );
}

export function DayPicker({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (days: number[]) => void;
}) {
  const labels = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
  return (
    <div className="flex gap-1.5">
      {labels.map((label, index) => {
        const day = index + 1;
        const isOn = selected.includes(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() =>
              onChange(
                isOn ? selected.filter((d) => d !== day) : [...selected, day].sort((a, b) => a - b),
              )
            }
            className={`h-11 flex-1 rounded-xl border text-[14px] font-semibold transition-colors ${
              isOn
                ? 'border-run bg-run/15 text-run'
                : 'border-base-600 bg-base-900 text-faint'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 text-left"
    >
      <span>
        <span className="block text-[14px] font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-snug text-faint">{hint}</span>}
      </span>
      <span
        className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors ${
          checked ? 'bg-run' : 'bg-base-700'
        }`}
      >
        <span
          className={`absolute top-[3px] h-6 w-6 rounded-full bg-white transition-all ${
            checked ? 'left-[23px]' : 'left-[3px]'
          }`}
        />
      </span>
    </button>
  );
}

export function SportDot({ sport, className = '' }: { sport: Sport; className?: string }) {
  return (
    <span className={`text-[15px] ${className}`} aria-hidden>
      {SPORT_ICONS[sport]}
    </span>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
}) {
  const tones = {
    neutral: 'bg-base-800 text-muted',
    good: 'bg-run/15 text-run',
    warn: 'bg-bike/15 text-bike',
    bad: 'bg-red-500/15 text-red-300',
    accent: 'bg-swim/15 text-swim',
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <Card className="px-5 py-8 text-center">
      <p className="text-[17px] font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-[32ch] text-[14px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-base-600 border-t-run" />
      {label && <span className="text-[14px] text-muted">{label}</span>}
    </div>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone: 'info' | 'warn' | 'error';
  children: ReactNode;
}) {
  const tones = {
    info: 'border-swim/30 bg-swim/10 text-swim',
    warn: 'border-bike/30 bg-bike/10 text-bike',
    error: 'border-red-500/30 bg-red-500/10 text-red-300',
  };
  return (
    <div className={`rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed ${tones[tone]}`}>
      {children}
    </div>
  );
}
