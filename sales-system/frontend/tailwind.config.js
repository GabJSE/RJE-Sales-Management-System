/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#2f7547",
          dark: "#1f6136",
          soft: "#e8f4eb",
        },
      },
      borderRadius: {
        card: "14px",
      },
      boxShadow: {
        card: "0 8px 24px rgba(20, 49, 32, .06)",
      },
    },
  },
  plugins: [],
};
