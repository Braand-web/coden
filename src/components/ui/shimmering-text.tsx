import * as React from 'react';
import { cn } from '../../lib/utils';

export type ShimmeringTextProps = React.HTMLAttributes<HTMLSpanElement> & {
  text: string;
};

export function ShimmeringText({ text, className, ...props }: ShimmeringTextProps) {
  return <span className={cn('coden-shimmering-text', className)} {...props}>{text}</span>;
}
