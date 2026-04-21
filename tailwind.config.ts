import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
    "./src/lib/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f2f2ed",
          100: "#e6e6dd",
          200: "#cccbb8",
          300: "#b3b195",
          400: "#999770",
          500: "#807d4b",
          600: "#66643c",
          700: "#4d4b2d",
          800: "#33321e",
          900: "#1a190f"
        }
      }
    }
  },
  plugins: [],
};

export default config;