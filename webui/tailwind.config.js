/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['../app/src/main/assets/web/index.html', '../app/src/main/assets/web/app.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
