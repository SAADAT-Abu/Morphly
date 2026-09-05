/**
 * The page tabs, one per figure in the document.
 *
 * A tab strip rather than a separate window per figure: a paper's figures are
 * worked on together, share a library and a set of colours, and are saved as
 * one project, so switching between them should cost a click and no file
 * juggling. Tabs sit directly above the canvas, so it is obvious they belong
 * to the artwork rather than to the app as a whole.
 */

import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../store";


/**
 * Tab icons are drawn, not typed.
 *
 * The pencil, copy and cross characters sit on different baselines and carry
 * different advance widths in every font, so as glyphs they never align inside
 * equally sized buttons. Paths on a shared 16x16 grid do.
 */
const TAB_ICON = {
  rename: <path d="M11.2 2.9 13.1 4.8 5.6 12.3 3 13l0.7-2.6z" />,
  duplicate: (
    <>
      <rect x="5.6" y="5.6" width="7.4" height="7.4" rx="1.2" />
      <path d="M10.4 3.2H3.6a0.6 0.6 0 0 0-0.6 0.6v6.8" />
    </>
  ),
  close: <path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6" />,
  add: <path d="M8 3.4v9.2M3.4 8h9.2" />,
};

function TabIcon({ name }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TAB_ICON[name]}
    </svg>
  );
}

export default function PageTabs() {
  const pages = useStore((s) => s.pages);
  const activePageId = useStore((s) => s.activePageId);
  const setActivePage = useStore((s) => s.setActivePage);
  const addPage = useStore((s) => s.addPage);
  const duplicatePage = useStore((s) => s.duplicatePage);
  const renamePage = useStore((s) => s.renamePage);
  const deletePage = useStore((s) => s.deletePage);
  const movePage = useStore((s) => s.movePage);

  /** id of the tab being renamed, or null */
  const [editingId, setEditingId] = useState(null);
  const dragId = useRef(null);

  // F2 and the Page menu ask for a rename through the store, since neither has
  // a way to reach into this component directly.
  const pendingRenamePageId = useStore((s) => s.pendingRenamePageId);
  const clearRenameRequest = useStore((s) => s.clearRenameRequest);
  useEffect(() => {
    if (!pendingRenamePageId) return;
    setEditingId(pendingRenamePageId);
    clearRenameRequest();
  }, [pendingRenamePageId, clearRenameRequest]);

  return (
    <div className="page-tabs" role="tablist" aria-label="Figures in this document">
      {pages.map((page, index) => (
        <Tab
          key={page.id}
          page={page}
          index={index}
          active={page.id === activePageId}
          canClose={pages.length > 1}
          editing={editingId === page.id}
          onSelect={() => setActivePage(page.id)}
          onStartRename={() => setEditingId(page.id)}
          onRename={(name) => {
            if (name.trim()) renamePage(page.id, name.trim());
            setEditingId(null);
          }}
          onDuplicate={() => duplicatePage(page.id)}
          onClose={async () => {
            // Deleting an empty page is trivially undoable by adding another;
            // deleting one with artwork on it is not, so that one asks.
            const live = useStore.getState().allPages().find((p) => p.id === page.id);
            if (live && live.elements.length > 0) {
              const res = await window.morphly.confirmDiscard({
                title: "Delete figure",
                message: `Delete "${live.name}"?`,
                detail: `This figure has ${live.elements.length} element${
                  live.elements.length === 1 ? "" : "s"
                } on it. Deleting it cannot be undone.`,
                confirmLabel: "Delete",
              });
              if (!res.discard) return;
            }
            deletePage(page.id);
          }}
          onDragStart={() => {
            dragId.current = page.id;
          }}
          onDropOn={() => {
            if (dragId.current && dragId.current !== page.id) movePage(dragId.current, index);
            dragId.current = null;
          }}
        />
      ))}

      <button className="page-add" onClick={addPage} title="New figure in this document">
        <TabIcon name="add" />
      </button>
    </div>
  );
}

function Tab({
  page,
  active,
  canClose,
  editing,
  onSelect,
  onStartRename,
  onRename,
  onDuplicate,
  onClose,
  onDragStart,
  onDropOn,
}) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState(page.name);

  useEffect(() => {
    if (editing) {
      setDraft(page.name);
      // Focus after the input actually exists, and select so typing replaces.
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [editing, page.name]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="page-tab renaming"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onRename(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onRename(draft);
          if (e.key === "Escape") onRename(page.name);
          e.stopPropagation();
        }}
      />
    );
  }

  return (
    <div
      className={`page-tab${active ? " active" : ""}`}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropOn}
      onClick={onSelect}
      onDoubleClick={onStartRename}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      title={`${page.name}\nDouble-click or press F2 to rename, drag to reorder`}
    >
      <span className="page-name">{page.name}</span>
      <button
        className="page-action"
        title="Rename this figure (F2)"
        onClick={(e) => {
          e.stopPropagation();
          onStartRename();
        }}
      >
        <TabIcon name="rename" />
      </button>
      <button
        className="page-action"
        title="Duplicate this figure"
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
      >
        <TabIcon name="duplicate" />
      </button>
      {canClose && (
        <button
          className="page-action"
          title="Delete this figure"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <TabIcon name="close" />
        </button>
      )}
    </div>
  );
}
