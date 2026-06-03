"use client";

import { FormEvent, useState } from "react";
import type { ClassDetail, ClassMember } from "@/lib/classroom";
import {
  archiveClass,
  leaveClass,
  regenerateJoinCode,
  removeMember,
  renameClass,
} from "@/lib/classAdmin";

const fieldClass =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400";
const labelClass = "flex flex-col gap-1 text-sm font-medium text-slate-700";
const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";
const dangerButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-red-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60";
const outlineButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md border border-teal px-4 text-sm font-medium text-teal transition hover:bg-teal/5 disabled:cursor-not-allowed disabled:opacity-60";

interface Props {
  classDetail: ClassDetail;
  /** Called after a mutation so the parent can re-fetch class data. */
  onRefresh: () => Promise<void>;
  /** Called after the user has left or the class was archived (remove from view). */
  onClose?: () => void;
}

export function ClassSettings({ classDetail, onRefresh, onClose }: Props) {
  const { class_room, role, roster } = classDetail;
  const isCoach = role === "coach";

  // --- rename ---
  const [renameValue, setRenameValue] = useState(class_room.name);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // --- join code ---
  const [currentCode, setCurrentCode] = useState(class_room.join_code);
  const [regenerating, setRegenerating] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  // --- archive ---
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archived, setArchived] = useState(
    (class_room as { archived?: boolean }).archived ?? false,
  );

  // --- remove member ---
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // --- leave ---
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const competitors: ClassMember[] = roster.filter(
    (m) => m.role === "competitor",
  );

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameValue.trim() || renameValue.trim() === class_room.name) return;
    setRenaming(true);
    setRenameError(null);
    try {
      await renameClass(class_room.id, renameValue.trim());
      await onRefresh();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Failed to rename class");
    } finally {
      setRenaming(false);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setCodeError(null);
    try {
      const updated = await regenerateJoinCode(class_room.id);
      setCurrentCode(updated.join_code);
      await onRefresh();
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : "Failed to regenerate code");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleToggleArchive() {
    setArchiving(true);
    setArchiveError(null);
    try {
      await archiveClass(class_room.id, !archived);
      setArchived((prev) => !prev);
      await onRefresh();
      if (!archived && onClose) onClose();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : "Failed to update class");
    } finally {
      setArchiving(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    setRemovingId(userId);
    setRemoveError(null);
    try {
      await removeMember(class_room.id, userId);
      await onRefresh();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleLeave() {
    if (!confirm("Are you sure you want to leave this class?")) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveClass(class_room.id);
      if (onClose) onClose();
    } catch (err) {
      setLeaveError(err instanceof Error ? err.message : "Failed to leave class");
      setLeaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-lg font-semibold text-slate-900">Class Settings</h3>

      {/* Coach-only panel */}
      {isCoach && (
        <>
          {/* Rename */}
          <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h4 className="text-sm font-semibold text-slate-700">Rename class</h4>
            <form onSubmit={handleRename} className="flex gap-2">
              <label className={`${labelClass} flex-1`}>
                <span className="sr-only">Class name</span>
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className={fieldClass}
                  placeholder="Class name"
                  required
                  aria-label="Class name"
                />
              </label>
              <button
                type="submit"
                disabled={renaming || !renameValue.trim()}
                className={primaryButtonClass}
              >
                {renaming ? "Saving..." : "Save"}
              </button>
            </form>
            {renameError && (
              <p className="text-xs text-red-600" role="alert">{renameError}</p>
            )}
          </section>

          {/* Join code */}
          <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h4 className="text-sm font-semibold text-slate-700">Join code</h4>
            <div className="flex items-center gap-3">
              <span
                className="rounded-md bg-white px-3 py-2 font-mono text-sm text-slate-700 border border-slate-200"
                data-testid="join-code"
              >
                {currentCode}
              </span>
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={regenerating}
                className={outlineButtonClass}
              >
                {regenerating ? "Regenerating..." : "Regenerate code"}
              </button>
            </div>
            {codeError && (
              <p className="text-xs text-red-600" role="alert">{codeError}</p>
            )}
          </section>

          {/* Roster management */}
          <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h4 className="text-sm font-semibold text-slate-700">
              Competitors ({competitors.length})
            </h4>
            {competitors.length === 0 ? (
              <p className="text-sm text-slate-600">No competitors yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {competitors.map((member) => (
                  <li
                    key={member.user_id}
                    className="flex items-center justify-between rounded-md bg-white px-3 py-2 border border-slate-200"
                  >
                    <span className="text-sm text-slate-700 font-mono">
                      {member.user_id.slice(0, 8)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(member.user_id)}
                      disabled={removingId === member.user_id}
                      className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-60"
                    >
                      {removingId === member.user_id ? "Removing..." : "Remove"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {removeError && (
              <p className="text-xs text-red-600" role="alert">{removeError}</p>
            )}
          </section>

          {/* Archive toggle */}
          <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h4 className="text-sm font-semibold text-slate-700">Archive class</h4>
            <p className="text-sm text-slate-600">
              {archived
                ? "This class is archived. Unarchive it to make it active again."
                : "Archiving hides the class from active lists without deleting data."}
            </p>
            <button
              type="button"
              onClick={handleToggleArchive}
              disabled={archiving}
              className={archived ? outlineButtonClass : dangerButtonClass}
            >
              {archiving
                ? "Saving..."
                : archived
                  ? "Unarchive class"
                  : "Archive class"}
            </button>
            {archiveError && (
              <p className="text-xs text-red-600" role="alert">{archiveError}</p>
            )}
          </section>
        </>
      )}

      {/* Leave class (all roles) */}
      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h4 className="text-sm font-semibold text-slate-700">Leave class</h4>
        <p className="text-sm text-slate-600">
          {isCoach
            ? "Coaches may only leave when another coach is present."
            : "You will lose access to assignments in this class."}
        </p>
        <button
          type="button"
          onClick={handleLeave}
          disabled={leaving}
          className={dangerButtonClass}
          data-testid="leave-class-btn"
        >
          {leaving ? "Leaving..." : "Leave class"}
        </button>
        {leaveError && (
          <p className="text-xs text-red-600" role="alert">{leaveError}</p>
        )}
      </section>
    </div>
  );
}
