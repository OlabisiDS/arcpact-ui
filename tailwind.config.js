/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        arc: {
          950: '#04060f',
          900: '#070b18',
          850: '#090e1e',
          800: '#0c1225',
          750: '#0f172e',
          700: '#131d38',
          650: '#172242',
          600: '#1c2a50',
          500: '#213160',
        },
        brand: {
          DEFAULT: '#2563eb',
          light:   '#3b82f6',
          glow:    'rgba(37,99,235,0.35)',
        },
        cyan: {
          glow: 'rgba(6,182,212,0.3)',
        },
      },
      backgroundImage: {
        'hero-radial':   'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(37,99,235,0.18) 0%, transparent 70%)',
        'card-shimmer':  'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 60%)',
        'grid-dark':     'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
        'glow-blue':     'radial-gradient(circle at center, rgba(37,99,235,0.25) 0%, transparent 65%)',
        'glow-cyan':     'radial-gradient(circle at center, rgba(6,182,212,0.15) 0%, transparent 65%)',
      },
      backgroundSize: {
        'grid': '48px 48px',
      },
      boxShadow: {
        'card':      '0 0 0 1px rgba(255,255,255,0.05), 0 4px 24px rgba(0,0,0,0.4)',
        'card-hover':'0 0 0 1px rgba(37,99,235,0.4), 0 8px 40px rgba(0,0,0,0.5)',
        'glow-sm':   '0 0 16px rgba(37,99,235,0.3)',
        'glow-md':   '0 0 32px rgba(37,99,235,0.25)',
        'inner-top': 'inset 0 1px 0 rgba(255,255,255,0.07)',
        'card-light':'0 1px 3px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)',
        'card-light-hover': '0 2px 8px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.10)',
      },
      animation: {
        'slide-up':    'slideUp 0.25s cubic-bezier(0.16,1,0.3,1)',
        'fade-in':     'fadeIn 0.2s ease-out',
        'pulse-slow':  'pulse 4s cubic-bezier(0.4,0,0.6,1) infinite',
        'shimmer':     'shimmer 2.5s linear infinite',
        'float':       'float 6s ease-in-out infinite',
      },
      keyframes: {
        slideUp:  { '0%': { opacity:'0', transform:'translateY(10px)' }, '100%': { opacity:'1', transform:'translateY(0)' } },
        fadeIn:   { '0%': { opacity:'0' }, '100%': { opacity:'1' } },
        shimmer:  { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        float:    { '0%,100%': { transform:'translateY(0)' }, '50%': { transform:'translateY(-8px)' } },
      },
    },
  },
  plugins: [],
}
