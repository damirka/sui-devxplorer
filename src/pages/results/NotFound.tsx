import { SearchX } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export function NotFound({ value }: { value: string }) {
  return (
    <div className="mt-4">
      <EmptyState
        icon={<SearchX size={40} strokeWidth={1.5} />}
        title="couldn't recognize that"
      >
        <span className="hash text-muted break-all">“{value}”</span> doesn't look
        like a sui address, object id, transaction digest, or package. check it
        and try again.
      </EmptyState>
    </div>
  )
}
