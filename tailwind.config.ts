import type { Config } from "tailwindcss";
// import scrollbarHide from "tailwind-scrollbar-hide";

// eslint-disable-next-line import/no-default-export
export default {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      keyframes: {
        "scan-line": {
          "0%": { top: "0%" },
          "100%": { top: "100%" },
        },
        subtleBounce: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" }, // smaller bounce
        },
        wheelSpin: {
          "0%, 24%": { transform: "rotate(0deg)" },
          "25%": { transform: "rotate(90deg)" },
          "45%": { transform: "rotate(180deg)" }, // pause
          "50%": { transform: "rotate(90deg)" },
          "70%": { transform: "rotate(270deg)" }, // pause
          "75%": { transform: "rotate(180deg)" },
          "95%": { transform: "rotate(270deg)" }, // pause
          "100%": { transform: "rotate(360deg)" },
        },

      },
      animation: {
        "scan-line": "scan-line 3s ease-in-out infinite",
        subtleBounce: "subtleBounce 1.2s infinite",
        slowSpin: "spin 2s linear infinite", // <- custom slower spin
        wheelSpin: "wheelSpin 3s ease-in-out infinite",

      },

      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        mat: {
          DEFAULT: "var(--mat)",
        },
        well: {
          DEFAULT: "var(--well)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        active: {
          DEFAULT: "var(--active)",
          foreground: "var(--active-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        action: {
          DEFAULT: "var(--action)",
          foreground: "var(--action-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
      },
      borderRadius: {
        xl: "calc(var(--radius) + 5px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 3px)",
        sm: "calc(var(--radius) - 2px)",
      },
      fontFamily: {
        sans: [
          '"SF Pro Text"',
          '"SF Pro Display"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Inter"',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  // plugins: [require("tailwindcss-animate"), scrollbarHide],
} satisfies Config;
