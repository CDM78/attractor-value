import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { TOOLTIP_CONTENT } from '../../utils/tooltipContent'

export default function InfoTooltip({ termKey, className = '' }) {
  const [visible, setVisible] = useState(false)
  const hideTimeout = useRef(null)
  const content = TOOLTIP_CONTENT[termKey]

  if (!content) return null

  const show = () => {
    clearTimeout(hideTimeout.current)
    setVisible(true)
  }

  const hide = () => {
    hideTimeout.current = setTimeout(() => setVisible(false), 150)
  }

  return (
    <span
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        onClick={() => setVisible(!visible)}
        className="ml-1 w-4 h-4 rounded-full bg-surface-tertiary text-text-secondary
                   text-[10px] flex items-center justify-center hover:bg-border
                   hover:text-text-primary cursor-help transition-colors"
        aria-label={`Info about ${content.label}`}
      >
        ?
      </button>
      {visible && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2
                        w-72 p-3 rounded-lg bg-surface-secondary border border-border
                        shadow-xl text-sm text-text-primary leading-relaxed">
          <div className="font-semibold text-accent mb-1">{content.label}</div>
          <div className="text-text-secondary">{content.description}</div>
          {content.formula && (
            <div className="mt-2 text-xs text-text-secondary font-mono bg-surface
                          rounded px-2 py-1">{content.formula}</div>
          )}
          <Link
            to={`/how-it-works#${content.anchor}`}
            className="mt-2 block text-xs text-accent hover:underline"
            onClick={() => setVisible(false)}
          >
            Learn more &rarr;
          </Link>
          <div className="absolute top-full left-1/2 -translate-x-1/2
                        border-4 border-transparent border-t-surface-secondary" />
        </div>
      )}
    </span>
  )
}
