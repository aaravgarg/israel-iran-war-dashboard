import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'Courier New'", "Courier", "monospace"],
      },
      colors: {
        war: {
          bg: "#080c18",
          panel: "#0f1624",
          border: "#1a2744",
          blue: "#3b82f6",
          red: "#ef4444",
          orange: "#f97316",
          green: "#22c55e",
          purple: "#a855f7",
          muted: "#4b5563",
          text: "#e2e8f0",
        },
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "flash-in": "flashIn 2s ease-out forwards",
      },
      keyframes: {
        flashIn: {
          "0%": { backgroundColor: "rgba(34, 197, 94, 0.2)" },
          "100%": { backgroundColor: "transparent" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
