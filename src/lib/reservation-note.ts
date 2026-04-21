/**
 * Parse reservation note to extract course and additional notes.
 * Supported formats:
 * - "コース: xxx"
 * - "Course: xxx"
 * - "備考: xxx"
 * - "Note: xxx"
 */
export function parseReservationNote(
  note: string | null | undefined
): { course: string | null; note: string | null } {
  if (!note) {
    return { course: null, note: null };
  }

  const lines = note
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let course: string | null = null;
  const noteLines: string[] = [];

  for (const line of lines) {
    const courseMatch = line.match(/^(?:コース|course)\s*[:：]\s*(.+)$/i);
    if (courseMatch) {
      course = courseMatch[1].trim();
      continue;
    }

    const noteMatch = line.match(/^(?:備考|note)\s*[:：]\s*(.+)$/i);
    if (noteMatch) {
      noteLines.push(noteMatch[1].trim());
      continue;
    }

    noteLines.push(line);
  }

  const mergedNote = noteLines.join("\n").trim();
  return {
    course,
    note: mergedNote || null,
  };
}

