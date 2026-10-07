import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { Tooltip } from './Tooltip';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, children, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, !children && 'btn-icon-only', className)}
      {...rest}
    >
      {icon}
      {children !== undefined && children !== null && children !== false && <span>{children}</span>}
      {iconRight}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
  label: string;
  icon: ReactNode;
  shortcut?: string;
}

/** Icon-only button with an accessible label shown as a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, shortcut, variant = 'ghost', ...rest },
  ref,
) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <Button ref={ref} variant={variant} icon={icon} aria-label={label} {...rest} />
    </Tooltip>
  );
});
