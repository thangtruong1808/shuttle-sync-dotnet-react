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
  resolved: "light",
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
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18 ? "light" : "dark";
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
    const sync = () => setSystem(systemTheme());
    sync();
    const timer = window.setInterval(sync, 60_000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
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
