import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: "#0B0E11", elevated: "#181A20", hover: "#2B3139" },
        border: { DEFAULT: "#2B3139", subtle: "#1E2329" },
        text: { DEFAULT: "#EAECEF", dim: "#B7BDC6", mute: "#848E9C" },
        accent: { DEFAULT: "#FCD535", hover: "#F0B90B", fg: "#202630" },
        buy: { DEFAULT: "#0ECB81", dim: "#0A7C50" },
        sell: { DEFAULT: "#F6465D", dim: "#80323F" },
        warn: "#F0B90B",
        info: "#5C8EFF",
        // Keep legacy navy tokens (Phase 0-9 chrome) until migration completes
        navy: {
          50: "#f6f9fc",
          100: "#eaf1f8",
          200: "#cfdeeb",
          300: "#a9c1d6",
          400: "#7fa3c0",
          500: "#5d86a8",
          600: "#456a8a",
          700: "#345070",
          800: "#243a55",
          900: "#142540",
          950: "#0a1929",
        },
        danger: { DEFAULT: "#dc2626", fg: "#fff1f1" },
        success: { DEFAULT: "#16a34a", fg: "#ecfdf5" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
        tabular: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "1.4" }],
      },
      boxShadow: {
        elevated: "0 4px 24px rgba(0, 0, 0, 0.4)",
      },
      keyframes: {
        pulse: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "0.8" },
        },
        flashBuy: {
          "0%": { backgroundColor: "rgba(14, 203, 129, 0.3)" },
          "100%": { backgroundColor: "transparent" },
        },
        flashSell: {
          "0%": { backgroundColor: "rgba(246, 70, 93, 0.3)" },
          "100%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        "flash-buy": "flashBuy 250ms ease-out",
        "flash-sell": "flashSell 250ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
