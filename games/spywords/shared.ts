/** Pure helpers shared by rules.ts and ui.tsx (nothing secret here). */
import { MAX_CLUE_COUNT, MAX_CLUE_LENGTH } from "./types";

/** The stored form of a clue word: trimmed and upper-cased. */
export function normalizeClue(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Why `raw` is not a valid clue against the unrevealed board words, or null if it is fine.
 * Strict mode also blocks clues that start or end with a board word, or that a board word starts or ends with
 * (compounds and word forms: board SNOWMAN blocks SNOW and SNOWMANS; board CAR blocks CARPET but not SCARY).
 */
export function clueProblem(raw: string, boardWords: readonly string[], strict: boolean): string | null {
  const word = normalizeClue(raw);
  if (!word) return "Type a one-word clue";
  if (word.length > MAX_CLUE_LENGTH) return `Clues are at most ${MAX_CLUE_LENGTH} letters`;
  if (!/^\p{L}+$/u.test(word)) return "One word, letters only";
  for (const boardWord of boardWords) {
    const b = boardWord.toUpperCase();
    if (word === b) return "That word is on the board";
    if (strict && (word.startsWith(b) || word.endsWith(b) || b.startsWith(word) || b.endsWith(word))) return "Too close to a word on the board";
  }
  return null;
}

/** Why `count` is not a valid clue number, or null. */
export function countProblem(count: number, allowZero: boolean): string | null {
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(count) || count < min || count > MAX_CLUE_COUNT) {
    return `Pick a number from ${min} to ${MAX_CLUE_COUNT}`;
  }
  return null;
}
