import type { Config } from "tailwindcss";

// Every color below resolves through a CSS variable (see globals.css),
// so the same class names work in both themes — `bg-surface` is a warm
// paper white in light mode and deep ink navy in dark mode, for example.
// `signal`/`blip` are the two accent colors and stay vivid in both themes.
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        surfaceHover: "rgb(var(--surface-hover) / <alpha-value>)",
        surfaceRaised: "rgb(var(--surface-raised) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        borderStrong: "rgb(var(--border-strong) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        textMuted: "rgb(var(--text-muted) / <alpha-value>)",
        textFaint: "rgb(var(--text-faint) / <alpha-value>)",
        onAccent: "#0B1220",
        signal: {
          DEFAULT: "rgb(var(--signal) / <alpha-value>)",
          text: "rgb(var(--signal-text) / <alpha-value>)",
          soft: "rgb(var(--signal-soft) / <alpha-value>)"
        },
        blip: {
          DEFAULT: "rgb(var(--blip) / <alpha-value>)",
          soft: "rgb(var(--blip-soft) / <alpha-value>)"
        }
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "serif"],
        body: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"]
      },
      borderRadius: {
        card: "14px"
      },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -12px rgb(0 0 0 / 0.18)",
        raised: "0 2px 6px rgb(0 0 0 / 0.06), 0 16px 40px -16px rgb(0 0 0 / 0.28)"
      },
      transitionProperty: {
        theme: "background-color, border-color, color, box-shadow, fill, stroke"
      }
    }
  },
  plugins: []
};

export default config;
