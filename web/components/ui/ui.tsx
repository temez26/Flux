"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { SpinnerIcon } from "./icons";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent-solid text-accent-fg shadow-sm hover:brightness-110",
  secondary: "border border-line bg-surface hover:bg-hover",
  ghost: "text-muted hover:bg-hover hover:text-fg",
  danger: "text-err hover:bg-err/10",
};

export function buttonClass(variant: Variant = "secondary", extra = "") {
  return `inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 ${variants[variant]} ${extra}`;
}

export const iconButtonClass =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-hover hover:text-fg active:scale-95";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

export function Button({ variant, className, ...props }: ButtonProps) {
  return <button type="button" className={buttonClass(variant, className)} {...props} />;
}

export function IconButton({
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={`${iconButtonClass} ${className}`} {...props} />
  );
}

/** A destructive control's wait for its second tap, which lapses if that tap doesn't come. */
function useArmed(): [boolean, (armed: boolean) => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [armed]);
  return [armed, setArmed];
}

/** ConfirmButton for a row with no room for words: an icon that turns red while it waits. */
export function ConfirmIconButton({
  label,
  onConfirm,
  children,
}: {
  label: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [armed, setArmed] = useArmed();
  return (
    <IconButton
      label={armed ? `Tap again: ${label}` : label}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
      className={armed ? "bg-err/10 !text-err" : "hover:!text-err"}
    >
      {children}
    </IconButton>
  );
}

/** Destructive action that needs a second tap, instead of a blocking dialog. */
export function ConfirmButton({ onConfirm, children }: { onConfirm: () => void; children: ReactNode }) {
  const [armed, setArmed] = useArmed();
  return (
    <Button
      variant={armed ? "primary" : "danger"}
      className={armed ? "!bg-err-solid" : ""}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      {armed ? "Tap again to confirm" : children}
    </Button>
  );
}

export const Spinner = ({ className = "size-4" }: { className?: string }) => (
  <SpinnerIcon className={`${className} animate-spin`} />
);

export type Tone = "muted" | "accent" | "ok" | "warn" | "err";

const soft: Record<Tone, string> = {
  muted: "bg-hover text-muted",
  accent: "bg-accent/10 text-accent",
  ok: "bg-ok/10 text-ok",
  warn: "bg-warn/10 text-warn",
  err: "bg-err/10 text-err",
};

const solid: Record<Tone, string> = {
  muted: "bg-muted",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
};

export function Badge({ tone = "muted", icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${soft[tone]}`}
    >
      {/* Sized here so no caller has to repeat it; a descendant rule outranks the icon's own class. */}
      {icon && <span className="flex shrink-0 [&_svg]:size-3">{icon}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** An aside inside a card: why something is waiting, blocked, or went wrong. */
export function Notice({
  tone = "muted",
  icon,
  role,
  className = "",
  children,
}: {
  tone?: Tone;
  icon?: ReactNode;
  role?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p role={role} className={`flex items-start gap-2 rounded-xl p-3 text-sm ${soft[tone]} ${className}`}>
      {icon && <span className="mt-0.5 flex shrink-0 [&_svg]:size-4">{icon}</span>}
      <span>{children}</span>
    </p>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5 ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ icon, children, aside }: { icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2.5 text-base font-semibold">
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent">{icon}</span>
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-line bg-bg p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition ${
              active ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg"
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ProgressBar({ value, tone = "accent", thin = false }: { value: number; tone?: Tone; thin?: boolean }) {
  const pct = Math.max(0, Math.min(1, value || 0)) * 100;
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`overflow-hidden rounded-full bg-line ${thin ? "h-1" : "h-2"}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ease-linear ${solid[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export interface StatusProps {
  tone: Tone;
  icon: ReactNode;
  title: string;
  subtitle?: string;
}

/** The state of a transfer at a glance: coloured icon, headline, progress, key numbers, actions. */
export function StatusCard({
  tone,
  icon,
  title,
  subtitle,
  percent,
  progress,
  stats,
  children,
  actions,
  danger,
}: StatusProps & {
  percent?: number;
  progress?: number;
  stats?: [string, string][];
  children?: ReactNode;
  actions?: ReactNode;
  danger?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${soft[tone]}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        {percent !== undefined && <span className="text-2xl font-semibold tabular-nums">{percent}%</span>}
      </div>
      {progress !== undefined && (
        <div className="mt-4">
          <ProgressBar value={progress} tone={tone} />
        </div>
      )}
      {stats && (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="truncate text-sm font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
      {(actions || danger) && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {actions}
          {danger && <div className="ml-auto">{danger}</div>}
        </div>
      )}
    </Card>
  );
}

export function Message({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      {icon && (
        <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-hover text-muted">{icon}</span>
      )}
      <h1 className="text-lg font-semibold">{title}</h1>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}
