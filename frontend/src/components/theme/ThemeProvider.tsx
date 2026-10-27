import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const storageKey = "shuttle-sync-theme";

type ThemeState = {
  theme: ThemeChoice;
  resolved: "light" | "dark";
  setTheme: (theme: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeState>({
  theme: "system",
  resolved: "dark",
  setTheme: () => undefined,
});

export function useTheme() {
  return useContext(ThemeContext);
}

function readChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  } catch {
    return "system";
  }
}

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  document.getElementById("theme-color")?.setAttribute("content", resolved === "dark" ? "#07140f" : "#f5f8f4");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(readChoice);
  const [system, setSystem] = useState<"light" | "dark">(systemTheme);
  const resolved = theme === "system" ? system : theme;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    apply(resolved);
  }, [resolved]);

  function setTheme(next: ThemeChoice) {
    setThemeState(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Private browsing can block storage. The choice still applies for this visit.
    }
  }

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}
