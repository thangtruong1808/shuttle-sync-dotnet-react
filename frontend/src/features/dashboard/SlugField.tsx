import { useId } from "react";
import { CircleAlert, Link2 } from "lucide-react";
import { slugError, venueAddress } from "../venues/slug";
import { control } from "./dashboardUi";

export function SlugField({ value, disabled, touched, onChange }: { value: string; disabled?: boolean; touched: boolean; onChange: (value: string) => void }) {
  const id = useId();
  const error = touched || value ? slugError(value) : null;
  return (
    <div className="block text-sm text-fg/80">
      <label htmlFor={id}>Slug</label>
      <div className="mt-1">
        <input
          id={id}
          className={control}
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-help`}
          onChange={(event) => onChange(event.target.value.toLowerCase().replace(/\s+/g, "-"))}
          required
        />
      </div>
      {error ? (
        <p id={`${id}-help`} className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-300">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : (
        <p id={`${id}-help`} className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-fg-muted">
          <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {venueAddress(value)}
        </p>
      )}
    </div>
  );
}
