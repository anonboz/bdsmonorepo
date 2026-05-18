import * as React from 'react';
import type { FieldError } from 'react-hook-form';

import { cn } from '../lib/cn.js';
import { Label } from './label.js';

/**
 * Minimal form-field wrapper for react-hook-form. Renders a label, the input
 * (passed as children), and an error message. Bigger flows can wrap this with
 * `react-hook-form`'s `Controller` for non-native inputs.
 *
 * Usage:
 *   <FormField label="Email" error={errors.email}>
 *     <Input {...register('email')} />
 *   </FormField>
 */
export interface FormFieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  error?: FieldError | { message?: string } | undefined;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  label,
  htmlFor,
  error,
  description,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {description && !error && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {error?.message && (
        <p className="text-xs text-destructive" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
