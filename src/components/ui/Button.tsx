import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost'
  icon?: boolean
}

export function Button({
  variant = 'ghost',
  icon = false,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'ghost' && 'btn-ghost',
        icon && 'btn-icon',
        className,
      )}
      {...props}
    />
  )
}
