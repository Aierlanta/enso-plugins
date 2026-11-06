import { motion } from 'motion/react';
import * as React from 'react';

import { HoverFill } from '@/components/hover-fill';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** 与首页 TierTabs 同一套样式：指示器与 hover 背景在组内平移 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: React.ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const id = React.useId();
  return (
    <HoverFill role="radiogroup" aria-label={label} className={cn('inline-flex h-8 items-center rounded-lg bg-muted p-0.5', className)} fillClassName="rounded-md bg-foreground/[0.04]">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-fill
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap outline-none transition-colors duration-200 focus-visible:ring-[3px] focus-visible:ring-ring/50',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active && <motion.span layoutId={`${id}-indicator`} transition={spring} className="absolute inset-0 -z-10 rounded-md bg-background shadow-sm dark:bg-input/40" />}
            {option.label}
          </button>
        );
      })}
    </HoverFill>
  );
}
