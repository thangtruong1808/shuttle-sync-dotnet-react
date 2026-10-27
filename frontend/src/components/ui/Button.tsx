import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./feedback";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
};

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg shadow-sm hover:brightness-95 active:brightness-90",
  secondary: "border border-border bg-surface text-fg shadow-sm hover:bg-surface-2",
  ghost: "text-fg hover:bg-fg/5",
  danger: "border border-rose-400/30 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-200",
  link: "px-0 py-0 text-accent-text underline-offset-4 hover:underline",
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: "rounded-lg px-3 py-1.5 text-sm",
  md: "rounded-xl px-4 py-2.5 text-sm",
  lg: "rounded-xl px-5 py-3 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") {
  const sizing = variant === "link" ? "text-sm" : buttonSizes[size];
  return `inline-flex items-center justify-center gap-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${sizing} ${buttonVariants[variant]} ${className}`;
}

export function Button({
  loading = false,
  variant = "primary",
  size = "md",
  icon,
  children,
  className = "",
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button type={type} aria-busy={loading} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...props}>
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}
