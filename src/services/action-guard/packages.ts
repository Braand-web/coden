/**
 * Package names an app is expected to install, and names that only look like them.
 *
 * `install_package` is how third-party code reaches the sandbox. A well-known
 * name passes at once; a name one keystroke away from a well-known one is the
 * classic way to be handed malware, and is refused with the name the agent
 * probably meant; anything else is unknown and goes to the judge.
 */
const POPULAR = [
  'react', 'react-dom', 'react-router', 'react-router-dom', 'next', 'vite', 'typescript', 'tailwindcss', 'postcss', 'autoprefixer', 'clsx', 'tailwind-merge', 'class-variance-authority',
  'lucide-react', 'framer-motion', 'motion', 'zustand', 'jotai', 'redux', '@reduxjs/toolkit', 'react-redux', 'axios', 'swr', 'zod', 'react-hook-form', 'date-fns', 'dayjs', 'lodash', 'uuid', 'nanoid',
  'recharts', 'chart.js', 'react-chartjs-2', 'd3', 'three', '@react-three/fiber', '@react-three/drei', 'gsap', 'sonner', 'react-hot-toast', 'react-icons', 'react-markdown', 'remark-gfm',
  '@supabase/supabase-js', 'firebase', 'stripe', '@stripe/stripe-js', '@stripe/react-stripe-js', 'express', 'cors', 'dotenv', 'prisma', '@prisma/client', 'drizzle-orm', 'mongoose', 'pg',
  '@tanstack/react-query', '@tanstack/react-table', '@tanstack/react-virtual', '@dnd-kit/core', '@dnd-kit/sortable', 'react-dnd', 'react-beautiful-dnd', 'embla-carousel-react', 'swiper',
  '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tabs', '@radix-ui/react-popover', '@radix-ui/react-select', '@radix-ui/react-slot', '@radix-ui/react-tooltip', '@headlessui/react', '@heroicons/react',
  'i18next', 'react-i18next', 'leaflet', 'react-leaflet', 'mapbox-gl', 'papaparse', 'xlsx', 'jspdf', 'html2canvas', 'qrcode', 'qrcode.react', 'marked', 'highlight.js', 'prismjs', 'vitest', 'eslint', 'prettier', 'sass', 'clsx',
  'react-datepicker', 'react-day-picker', 'react-select', 'react-dropzone', 'react-window', 'react-virtualized', 'react-query', 'immer', 'ramda', 'cookie', 'js-cookie', 'jsonwebtoken', 'bcryptjs', 'socket.io-client', 'socket.io',
];
const POPULAR_SET = new Set(POPULAR);

/** The name without a version or a tag: `react@18` is react. */
export function bareName(name: string): string {
  const value = String(name || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  return at > 0 ? value.slice(0, at) : value;
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const held = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = held;
    }
  }
  return row[b.length];
}

export type PackageJudgement =
  | { verdict: 'known' }
  | { verdict: 'lookalike'; meant: string }
  | { verdict: 'unknown' };

export function judgePackage(name: string): PackageJudgement {
  const bare = bareName(name);
  if (POPULAR_SET.has(bare) || bare.startsWith('@types/')) return { verdict: 'known' };
  for (const known of POPULAR) {
    if (known.length >= 5 && bare !== known && distance(bare, known) <= 1) return { verdict: 'lookalike', meant: known };
  }
  return { verdict: 'unknown' };
}
