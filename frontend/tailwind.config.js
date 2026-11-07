/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        canvas: token("canvas"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        inset: token("inset"),
        fg: token("fg"),
        "fg-muted": token("fg-muted"),
        border: token("border"),
        accent: {
          DEFAULT: token("accent"),
          fg: token("accent-fg"),
          text: token("accent-text"),
        },
      },
      fontSize: {
        display: ["clamp(1.875rem, 4.8vw, 3.5rem)", { lineHeight: "1.08", letterSpacing: "-0.02em" }],
      },
      boxShadow: {
        card: "0 1px 2px rgb(var(--shadow) / 0.06), 0 4px 16px -4px rgb(var(--shadow) / 0.08)",
        pop: "0 12px 32px -8px rgb(var(--shadow) / 0.25)",
      },
    },
  },
  plugins: [],
}
