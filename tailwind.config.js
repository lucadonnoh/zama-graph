/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // the page's color tokens (index.css), as text-ink, text-muted, …
      colors: {
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        muted: 'var(--muted)',
        negative: 'var(--negative)',
      },
    },
  },
}
