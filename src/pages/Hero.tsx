import { SearchBar } from '@/components/ui/SearchBar'
import { LiveStrip } from './LiveStrip'

/** Landing: nothing but the prompt. The search IS the page — centered in the
 * space above, with its grammar taught on demand by the focus/typing hints
 * dropdown. A live status bar anchors the bottom — the one sign of a beating
 * chain, kept clear of the dropdown that drops from the centered search. */
export function Hero() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 items-center justify-center pb-16">
        <div className="w-full max-w-2xl px-2">
          <SearchBar variant="hero" autoFocus hints />
        </div>
      </div>
      <LiveStrip />
    </div>
  )
}
