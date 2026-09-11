/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0f1a",
          900: "#121826",
          800: "#1c2536",
          700: "#3d4a5c",
          600: "#5c6b7e",
          500: "#7a8799",
        },
        mist: {
          50: "#f4f7f8",
          100: "#e8eef1",
          200: "#d5e0e6",
        },
        pine: {
          DEFAULT: "#0d7a6f",
          soft: "#1a9b8e",
          deep: "#0a5c54",
          wash: "#e6f5f3",
        },
        // keep aliases used across app
        sand: {
          50: "#f4f7f8",
          100: "#e8eef1",
          200: "#d5e0e6",
        },
        accent: {
          DEFAULT: "#0d7a6f",
          soft: "#1a9b8e",
          deep: "#0a5c54",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        lift: "0 1px 0 rgba(10,15,26,0.04), 0 12px 32px rgba(10,15,26,0.08)",
        soft: "0 1px 2px rgba(10,15,26,0.04)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "pulse-line": {
          "0%, 100%": { opacity: "0.45" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-up-delay": "fade-up 0.65s cubic-bezier(0.22, 1, 0.36, 1) 0.08s both",
        "fade-in": "fade-in 0.4s ease both",
        shimmer: "shimmer 2.2s linear infinite",
        "pulse-line": "pulse-line 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
