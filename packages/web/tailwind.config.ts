import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        display: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        // Primary brand — modern emerald (refreshed from old green).
        // Keeps the `brand-*` token name used across the codebase.
        brand: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22",
        },
        // Secondary accent — violet, used for AI-SaaS gradients.
        accent: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
        },
        // Tertiary — cyan for gradient bridge between emerald & violet.
        cyan: {
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
        },
        // Surface tokens (mapped to CSS variables for theme switching).
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          muted: "rgb(var(--surface-muted) / <alpha-value>)",
          raised: "rgb(var(--surface-raised) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          muted: "rgb(var(--ink-muted) / <alpha-value>)",
          subtle: "rgb(var(--ink-subtle) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--line) / <alpha-value>)",
          strong: "rgb(var(--line-strong) / <alpha-value>)",
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "mesh-light":
          "radial-gradient(at 15% 20%, rgba(16,185,129,0.18) 0px, transparent 50%), radial-gradient(at 85% 15%, rgba(139,92,246,0.16) 0px, transparent 50%), radial-gradient(at 50% 90%, rgba(6,182,212,0.14) 0px, transparent 50%)",
        "mesh-dark":
          "radial-gradient(at 15% 20%, rgba(16,185,129,0.22) 0px, transparent 50%), radial-gradient(at 85% 15%, rgba(139,92,246,0.22) 0px, transparent 50%), radial-gradient(at 50% 90%, rgba(6,182,212,0.16) 0px, transparent 50%)",
        "brand-gradient":
          "linear-gradient(135deg, #10b981 0%, #06b6d4 55%, #8b5cf6 100%)",
        "brand-gradient-soft":
          "linear-gradient(135deg, rgba(16,185,129,0.85) 0%, rgba(6,182,212,0.85) 55%, rgba(139,92,246,0.85) 100%)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(16,185,129,0.25), 0 8px 32px -8px rgba(16,185,129,0.45)",
        "glow-accent":
          "0 0 0 1px rgba(139,92,246,0.25), 0 8px 32px -8px rgba(139,92,246,0.45)",
        glass: "0 8px 32px -8px rgba(15, 23, 42, 0.18), inset 0 1px 0 0 rgba(255,255,255,0.6)",
        "glass-dark":
          "0 8px 32px -8px rgba(0, 0, 0, 0.5), inset 0 1px 0 0 rgba(255,255,255,0.06)",
      },
      keyframes: {
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "gradient-shift": "gradient-shift 8s ease infinite",
        shimmer: "shimmer 2s linear infinite",
        float: "float 4s ease-in-out infinite",
        "fade-up": "fade-up 0.4s ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
