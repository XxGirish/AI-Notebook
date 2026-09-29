/**
 * Text comparison primitives for the prompt evaluation.
 *
 * These measure one thing only: how much of a generated string is already
 * present in the notebook text the model was given. They are not a judgement of
 * quality. A low overlap can still be wrong and a high overlap can be a
 * legitimate quotation, so the report prints the numbers next to the content
 * rather than in place of it.
 */

/** Words, lowercased, with punctuation and LaTeX control sequences removed. */
export function words(value: string): string[] {
  return value
    .toLowerCase()
    .replaceAll(/\\[a-z]+/g, " ")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 0);
}

/** Overlapping word n-grams. Shorter input than `size` yields the whole phrase. */
export function shingles(value: string, size: number): Set<string> {
  const list = words(value);
  if (list.length === 0) return new Set();
  if (list.length <= size) return new Set([list.join(" ")]);
  const result = new Set<string>();
  for (let index = 0; index + size <= list.length; index += 1) {
    result.add(list.slice(index, index + size).join(" "));
  }
  return result;
}

/**
 * The fraction of `candidate`'s shingles that also appear in `source`.
 *
 * Containment, not Jaccard: a short generated paragraph copied out of a long
 * page should score near 1, and Jaccard would hide that behind the length
 * difference. Returns 0 when the candidate has no content to judge.
 */
export function containment(candidate: string, source: string, size = 5): number {
  const candidateShingles = shingles(candidate, size);
  if (candidateShingles.size === 0) return 0;
  const sourceShingles = shingles(source, size);
  let shared = 0;
  for (const shingle of candidateShingles) {
    if (sourceShingles.has(shingle)) shared += 1;
  }
  return shared / candidateShingles.size;
}

/**
 * Sentence-ish fragments of at least `minimumWords` words.
 *
 * The floor matters. Card titles, headings and option labels are short phrases
 * drawn from the subject, and two of them matching says nothing: "The cost of
 * the change" appearing in both a page heading and a generated sentence is not
 * a restatement. Only a full sentence coming back is.
 */
export function sentences(value: string, minimumWords = 4): string[] {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => words(sentence).length >= minimumWords);
}

/**
 * Dice coefficient over word bigrams: a symmetric similarity that tolerates
 * reordering and small edits, which is what paraphrase looks like. Identical
 * strings score 1; one-word inputs fall back to exact comparison.
 */
export function similarity(left: string, right: string): number {
  const leftBigrams = shingles(left, 2);
  const rightBigrams = shingles(right, 2);
  if (leftBigrams.size === 0 || rightBigrams.size === 0) return 0;
  let shared = 0;
  for (const bigram of leftBigrams) {
    if (rightBigrams.has(bigram)) shared += 1;
  }
  return (2 * shared) / (leftBigrams.size + rightBigrams.size);
}

/**
 * The highest similarity between any candidate sentence and any source sentence,
 * counting only sentences long enough for a match to mean something.
 */
export function maxSentenceEcho(candidate: string, source: string, minimumWords = 10): number {
  const sourceSentences = sentences(source, minimumWords);
  if (sourceSentences.length === 0) return 0;
  let highest = 0;
  for (const candidateSentence of sentences(candidate, minimumWords)) {
    for (const sourceSentence of sourceSentences) {
      highest = Math.max(highest, similarity(candidateSentence, sourceSentence));
    }
  }
  return highest;
}

/** The highest similarity between any two distinct strings in a list. */
export function maxPairwiseSimilarity(values: string[]): number {
  let highest = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      highest = Math.max(highest, similarity(values[i], values[j]));
    }
  }
  return highest;
}
