/**
 * A small dialog for the settings most people never touch.
 *
 * The properties panel shows what is changed on most figures; anything that
 * is a choice about method rather than appearance lives behind an "Advanced"
 * link, so a first figure can be made without meeting any of it.
 */

import React from "react";

export default function AdvancedDialog({ title, onClose, onReset, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal advanced-modal" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="advanced-body">{children}</div>
        <div className="modal-actions">
          {onReset && (
            <button className="ghost" onClick={onReset}>
              Back to defaults
            </button>
          )}
          <span className="spacer" />
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
