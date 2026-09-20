import { motion, useReducedMotion } from 'motion/react';
export function ShimmeringText({ text, className = '' }: { text: string; className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <span className={className}>{text}</span>;
  return <motion.span className={className} style={{ display: 'inline-block', backgroundClip: 'text', color: 'transparent', backgroundImage: 'var(--surface)', backgroundSize: '220% 100%' }} animate={{ backgroundPosition: ['120% 0%', '-120% 0%'] }} transition={{ duration: 2.1, ease: 'linear', repeat: Infinity }}>{text}</motion.span>;
}
