import { cn } from '@/lib/cn'

export function Skeleton({
  className,
}: {
  className?: string
}) {
  return <div className={cn('skeleton h-4 w-full', className)} />
}

/** A few stacked skeleton lines for placeholder content. */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(i === count - 1 && 'w-2/3')}
        />
      ))}
    </div>
  )
}
