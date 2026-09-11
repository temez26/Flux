"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110",
  secondary: "border border-line bg-surface hover:bg-hover",
  danger: "border border-line bg-surface text-err hover:bg-hover",
};

export function buttonClass(variant: Variant = "secondary", extra = "") {
  return `inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 ${variants[variant]} ${extra}`;
}

export const iconButtonClass =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-hover hover:text-fg active:scale-95";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

export function Button({ variant, className, ...props }: ButtonProps) {
  return <button type="button" className={buttonClass(variant, className)} {...props} />;
}

/** Destructive action that needs a second tap, instead of a blocking dialog. */
export function ConfirmButton({ onConfirm, children }: { onConfirm: () => void; children: ReactNode }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <Button variant="danger" onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? "Tap again to confirm" : children}
    </Button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-4 sm:p-5 ${className}`}>{children}</section>;
}

export function ProgressBar({ value, thin = false }: { value: number; thin?: boolean }) {
  const pct = Math.max(0, Math.min(1, value || 0)) * 100;
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`overflow-hidden rounded-full bg-line ${thin ? "h-1" : "h-2"}`}
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-linear" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-16 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}
