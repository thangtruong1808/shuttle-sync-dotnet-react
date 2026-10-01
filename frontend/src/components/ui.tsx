import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Calendar, LoaderCircle } from "lucide-react";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <LoaderCircle className={`motion-safe:animate-spin ${className}`} aria-hidden="true" />;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/10 ${className}`} aria-hidden="true" />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger";
  icon?: ReactNode;
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-line text-ink hover:bg-lime-300",
  secondary: "border border-white/15 bg-white/5 text-mist hover:bg-white/10",
  danger: "border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20",
};

type PickerType = "date" | "time" | "datetime-local";

type PickerProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type: PickerType;
};

export function PickerInput({ type, className = "", onKeyDown, onPaste, onBeforeInput, onClick, disabled, ...props }: PickerProps) {
  return (
    <span className="relative block">
      <input
        {...props}
        type={type}
        disabled={disabled}
        inputMode="none"
        className={`picker-input pr-9 ${className}`}
        onKeyDown={(event) => {
          if (event.key !== "Tab" && event.key !== "Escape") {
            event.preventDefault();
          }
          onKeyDown?.(event);
        }}
        onPaste={(event) => {
          event.preventDefault();
          onPaste?.(event);
        }}
        onBeforeInput={(event) => {
          event.preventDefault();
          onBeforeInput?.(event);
        }}
        onDrop={(event) => {
          event.preventDefault();
        }}
        onClick={(event) => {
          const field = event.currentTarget;
          if (!disabled && typeof field.showPicker === "function") {
            try {
              field.showPicker();
            } catch {
              // The picker can already be open.
            }
          }
          onClick?.(event);
        }}
      />
      <Calendar className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white" aria-hidden="true" />
    </span>
  );
}

export function Button({
  loading = false,
  variant = "primary",
  icon,
  children,
  className = "",
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={loading}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}
