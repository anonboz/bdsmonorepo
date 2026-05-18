import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '../lib/cn.js';

export const Spinner = React.forwardRef<
  SVGSVGElement,
  React.HTMLAttributes<SVGSVGElement> & { size?: number }
>(({ className, size = 16, ...props }, ref) => (
  <Loader2
    ref={ref}
    aria-label="Loading"
    role="status"
    className={cn('animate-spin', className)}
    width={size}
    height={size}
    {...props}
  />
));
Spinner.displayName = 'Spinner';
