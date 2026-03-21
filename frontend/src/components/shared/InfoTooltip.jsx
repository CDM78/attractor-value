import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { TOOLTIP_CONTENT } from '../../utils/tooltipContent'

export default function InfoTooltip({ termKey, className = '' }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState(null)
  const hideTimeout = useRef(null)
  const btnRef = useRef(null)
  const content = TOOLTIP_CONTENT[termKey]

  if (!content) return null

  const show = () => {
    clearTimeout(hideTimeout.current)
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.top, left: rect.left + rect.width / 2 })
    }
    setVisible(true)
  }

  const hide = () => {
    hideTimeout.current = setTimeout(() => setVisible(false), 150)
  }

  const tooltip = visible && pos && createPortal(
    <div
      className="fixed z-[9999] w-72 p-3 rounded-lg bg-surface-secondary border border-border
                 shadow-xl text-sm text-text-primary leading-relaxed"
      style={{ top: pos.top - 8, left: pos.left, transform: 'translate(-50%, -100%)' }}
      onMouseEnter={() => { clearTimeout(hideTimeout.current) }}
      onMouseLeave={hide}
    >
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
    </div>,
    document.body
  )

  return (
    <span className={`inline-flex items-center ${className}`}>
      <button
        ref={btnRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={() => visible ? setVisible(false) : show()}
        className="ml-1 w-4 h-4 rounded-full bg-surface-tertiary text-text-secondary
                   text-[10px] flex items-center justify-center hover:bg-border
                   hover:text-text-primary cursor-help transition-colors"
        aria-label={`Info about ${content.label}`}
      >
        ?
      </button>
      {tooltip}
    </span>
  )
}
