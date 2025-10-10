import * as React from 'react';
import { cn } from '@/lib/utils';

interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ScrollArea({ className, children, ...props }: ScrollAreaProps) {
  return (
    <div
      className={cn('overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900', className)}
      {...props}
    >
      {children}
    </div>
  );
}
