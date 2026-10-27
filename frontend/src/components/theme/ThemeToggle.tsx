import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeChoice } from "./ThemeProvider";

const options: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeToggle({ showLabels = false, className = "" }: { showLabels?: boolean; className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={`inline-flex items-center gap-0.5 rounded-xl border border-border bg-surface-2/70 p-0.5 ${className}`}>
      {options.map((option) => {
        const active = theme === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${option.label} theme`}
            title={`${option.label} theme`}
            onClick={() => setTheme(option.value)}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors ${showLabels ? "flex-1 px-2.5" : "w-8"} ${
              active ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {showLabels ? option.label : null}
          </button>
        );
      })}
    </div>
  );
}
