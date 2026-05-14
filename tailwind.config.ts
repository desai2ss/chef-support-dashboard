import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1f1f1f",
        cream: "#f7f7f5",
        line: "#e6e4df",
        muted: "#6b6b6b",
      },
    },
  },
  plugins: [],
};

export default config;
