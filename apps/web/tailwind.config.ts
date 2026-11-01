import type { Config } from 'tailwindcss';

export default <Config>{
  darkMode: 'class',
  content: [
    './src/**/*.{ts,tsx,js,jsx}',
    './index.html',
    './apps/web/src/**/*.{ts,tsx,js,jsx}',
    './apps/web/index.html',
  ],
  theme: {
    extend: {
      colors: {
        background: '#090B10',
        surface: '#11141C',
        'surface-secondary': '#171B25',
        'surface-tertiary': '#1D2330',
        border: '#252C39',
        'border-hover': '#374357',
        'text-primary': '#F4F6FA',
        'text-secondary': '#929BAD',
        'text-muted': '#697386',
        accent: '#4389F5',
        'accent-hover': '#5A9BFF',
        success: '#28C98B',
        warning: '#E8AC4A',
        danger: '#EF6464',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
