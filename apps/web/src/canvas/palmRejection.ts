/**
 * Palm rejection for passive styluses.
 *
 * A passive (capacitive) stylus has no digitizer of its own, so the screen
 * reports its tip as `pointerType: "touch"` — exactly like the hand resting
 * beside it. The one thing that does separate them is the contact footprint:
 * a stylus tip is a few millimetres across, a palm is a few centimetres. Touch
 * pointer events carry that footprint as `width`/`height`, so the rule is
 * simply "the smallest thing on the glass is the pen".
 */

export type Contact = {
  pointerId: number;
  pointerType: string;
  /** Largest footprint seen for this contact so far, in CSS pixels. */
  size: number;
  /** Event timestamp of the contact's first sample. */
  startedAt: number;
};

/** Browsers report a 1x1 footprint when the digitizer gives no geometry. */
export const UNKNOWN_CONTACT_SIZE = 1;

/** A contact at least this wide is a hand, never a stylus tip. */
export const PALM_SIZE_PX = 35;

/** A contact this many times larger than the smallest one is the hand. */
export const PALM_SIZE_RATIO = 1.6;

export function contactSize(sample: { width?: number; height?: number }) {
  const width = Number.isFinite(sample.width) ? Number(sample.width) : 0;
  const height = Number.isFinite(sample.height) ? Number(sample.height) : 0;
  return Math.max(width, height, 0);
}

/**
 * Whether this screen measures contact footprints at all. Without geometry
 * every contact looks identical and a palm cannot be told from a tip, so the
 * caller is expected to say so rather than silently rejecting the wrong one.
 */
export function reportsContactGeometry(contacts: Contact[]) {
  return contacts.some((contact) => contact.size > UNKNOWN_CONTACT_SIZE);
}

const smallestOf = (contacts: Contact[]) =>
  contacts.reduce((best, contact) => (contact.size < best.size ? contact : best));

const earliestOf = (contacts: Contact[]) =>
  contacts.reduce((best, contact) => (contact.startedAt < best.startedAt ? contact : best));

/**
 * Picks the one contact allowed to draw. Everything else on the glass is a
 * palm, a knuckle or a stray finger and is ignored outright — it must not draw
 * and must not pan, or resting a hand would still shove the canvas about.
 */
export function inkingContactId(contacts: Contact[]): number | undefined {
  if (contacts.length === 0) return undefined;

  // A real stylus beats every finger on the glass, whatever the footprints say.
  const pens = contacts.filter((contact) => contact.pointerType === "pen");
  if (pens.length > 0) return earliestOf(pens).pointerId;

  // A hand-sized contact never draws, not even when it is the only thing on
  // the glass: a palm put down while the writer thinks about the next word is
  // exactly the mark this mode exists to prevent.
  const candidates = contacts.filter((contact) => contact.size < PALM_SIZE_PX);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0].pointerId;

  const smallest = smallestOf(candidates);
  const clearlySmaller = candidates
    .filter((contact) => contact.pointerId !== smallest.pointerId)
    .every((contact) => contact.size >= smallest.size * PALM_SIZE_RATIO);
  if (clearlySmaller) return smallest.pointerId;

  // Footprints too close to call, or none reported at all. Stay with the
  // contact that started first — whichever it is, it is the one already
  // drawing, and flickering between contacts mid-stroke is worse than either.
  return earliestOf(candidates).pointerId;
}
