import { SearchBar } from '@/components/ui/SearchBar'

/** Landing: the prompt is the search, centered in the viewport. Nothing else. */
export function Hero() {
  return (
    <div className="flex flex-1 items-center justify-center pb-16">
      <div className="w-full max-w-2xl px-2">
        <SearchBar variant="hero" autoFocus />
      </div>
    </div>
  )
}
