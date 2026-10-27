import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Calendar, CircleAlert, Eye, EyeOff } from "lucide-react";

export const controlClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-fg shadow-sm outline-none transition-colors placeholder:text-fg-muted/70 focus:border-accent-text focus:ring-2 focus:ring-accent-text/20 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-rose-500";

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`text-sm ${className}`}>
      <label htmlFor={id} className="mb-1.5 block font-medium text-fg">
        {label}
        {required ? <span className="ml-0.5 text-rose-600 dark:text-rose-300" aria-hidden="true">*</span> : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error ? <p id={hintId} className="mt-1.5 text-xs text-fg-muted">{hint}</p> : null}
      {error ? (
        <p id={errorId} className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-300">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = "", ...props }, ref) {
  return <input ref={ref} className={`${controlClass} ${className}`} {...props} />;
});

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${controlClass} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${controlClass} min-h-24 ${className}`} {...props} />;
}

export function PasswordInput({ className = "", disabled, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <input {...props} disabled={disabled} type={visible ? "text" : "password"} className={`${controlClass} pr-11 ${className}`} />
      <button
        type="button"
        className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-fg-muted transition hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </span>
  );
}

type PickerType = "date" | "time" | "datetime-local";

type PickerProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type: PickerType;
};

export function PickerInput({ type, className = "", iconClassName = "text-fg-muted", onKeyDown, onPaste, onBeforeInput, onClick, disabled, ...props }: PickerProps & { iconClassName?: string }) {
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
      <Calendar className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 ${iconClassName}`} aria-hidden="true" />
    </span>
  );
}
