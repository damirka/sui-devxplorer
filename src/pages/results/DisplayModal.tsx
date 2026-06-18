import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Muted } from '@/components/ui/Field'
import { EntityLink } from '@/components/ui/links'

/** Pull a non-empty string field out of a rendered `display.output` map. */
function field(output: Record<string, unknown> | null, key: string): string | null {
  const v = output?.[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** Only http(s) / ipfs / data-image URLs are safe to render — a display field is
 * on-chain data and could carry a `javascript:` URL. ipfs is resolved to a
 * gateway so the `<img>` actually loads. */
function safeUrl(url: string): string | null {
  if (/^https?:\/\//i.test(url)) return url
  if (/^ipfs:\/\//i.test(url)) return `https://ipfs.io/ipfs/${url.slice(7).replace(/^ipfs\//, '')}`
  if (/^data:image\//i.test(url)) return url
  return null
}

/** An on-chain address renders as an internal search link; anything else
 * (a name, a label) stays plain text. */
function CreatorValue({ value }: { value: string }) {
  if (/^0x[0-9a-fA-F]{1,64}$/.test(value)) return <EntityLink id={value} />
  return <span className="text-text break-all">{value}</span>
}

/** A safe external link with an out-arrow; unsafe schemes degrade to text. */
function ExtLink({ url }: { url: string }) {
  const href = safeUrl(url)
  if (!href) return <span className="text-text break-all">{url}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary inline-flex min-w-0 items-center gap-1 break-all hover:underline"
    >
      <span className="min-w-0 break-all">{url}</span>
      <ExternalLink size={11} className="shrink-0" />
    </a>
  )
}

interface DisplayModalProps {
  open: boolean
  onClose: () => void
  /** The object's rendered `display.output` map; null while a version reloads. */
  output: Record<string, unknown> | null
  /** True while the object is re-fetching (e.g. stepping versions). */
  loading: boolean
  version: number | null
  /** Neighbour versions for the stepper; null when none in that direction. */
  olderVersion: number | null
  newerVersion: number | null
  /** Navigate the object to a specific version. */
  onStep: (version: number) => void
}

/**
 * A modal rendering an object's Sui Display the way a wallet would: the
 * `image_url` as an image, with name / description / project_url / creator /
 * link. The last rendered display is retained across a version reload so
 * stepping through versions updates in place instead of blanking — the whole
 * point of keeping the modal open while you scroll history.
 */
export function DisplayModal({
  open,
  onClose,
  output,
  loading,
  version,
  olderVersion,
  newerVersion,
  onStep,
}: DisplayModalProps) {
  // Retain the last non-null output (+ its version) so the card doesn't flash
  // empty during the reload between versions.
  const [shown, setShown] = useState<Record<string, unknown> | null>(output)
  const [shownVersion, setShownVersion] = useState<number | null>(version)
  useEffect(() => {
    if (output) {
      setShown(output)
      setShownVersion(version)
    }
  }, [output, version])

  const image = field(shown, 'image_url')
  const safeImage = image ? safeUrl(image) : null
  const name = field(shown, 'name')
  const description = field(shown, 'description')
  const projectUrl = field(shown, 'project_url')
  const creator = field(shown, 'creator')
  const link = field(shown, 'link')

  const [imgError, setImgError] = useState(false)
  // Reset the broken-image state whenever the image source changes.
  useEffect(() => setImgError(false), [safeImage])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rendered display"
      actions={
        <span className="text-muted flex items-center gap-1.5 font-mono text-xs">
          {loading && <Loader2 size={12} className="animate-spin" />}
          {shownVersion != null && <span>v{shownVersion}</span>}
          <button
            type="button"
            disabled={olderVersion == null}
            onClick={() => olderVersion != null && onStep(olderVersion)}
            title="older version"
            aria-label="older version"
            className="hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-current"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            disabled={newerVersion == null}
            onClick={() => newerVersion != null && onStep(newerVersion)}
            title="newer version"
            aria-label="newer version"
            className="hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-current"
          >
            <ChevronRight size={14} />
          </button>
        </span>
      }
    >
      <div className="space-y-4 p-4">
        {safeImage && !imgError ? (
          <img
            src={safeImage}
            alt={name ?? 'display image'}
            loading="lazy"
            onError={() => setImgError(true)}
            className="border-line bg-surface-2 max-h-80 w-full border object-contain"
          />
        ) : image ? (
          <div className="border-line bg-surface-2 text-muted flex h-40 flex-col items-center justify-center gap-2 border font-mono text-xs">
            <ImageOff size={20} />
            image could not be loaded
          </div>
        ) : null}

        {name && (
          <h2 className="font-mono text-base font-medium break-words">{name}</h2>
        )}
        {description && (
          <p className="text-muted text-sm break-words whitespace-pre-wrap">
            {description}
          </p>
        )}

        {(projectUrl || creator || link) && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-line pt-4 font-mono text-xs">
            {projectUrl && (
              <>
                <dt className="panel-label">project</dt>
                <dd className="min-w-0">
                  <ExtLink url={projectUrl} />
                </dd>
              </>
            )}
            {link && (
              <>
                <dt className="panel-label">link</dt>
                <dd className="min-w-0">
                  <ExtLink url={link} />
                </dd>
              </>
            )}
            {creator && (
              <>
                <dt className="panel-label">creator</dt>
                <dd className="min-w-0">
                  <CreatorValue value={creator} />
                </dd>
              </>
            )}
          </dl>
        )}

        {!shown && (
          <Muted>no rendered display for this object.</Muted>
        )}
      </div>
    </Modal>
  )
}
