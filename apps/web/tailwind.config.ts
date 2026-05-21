import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        teal: {
          DEFAULT: "#0f766e",
          dark: "#115e59",
        },
      },
    },
  },
  plugins: [],
};

export default config;
