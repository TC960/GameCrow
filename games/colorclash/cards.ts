/** Pure Color Clash card helpers, safe for rules.ts, ui.tsx and tests. See BRIEF.md §1. */
import {
  ACTION_VALUES,
  COLORS,
  COLOR_INFO,
  NUMBER_VALUES,
  VALUE_LABEL,
  VALUE_ORDER,
  WILD_VALUES,
  type CardColor,
  type CardId,
  type CardValue,
  type ColorId,
} from "./types";

export interface ParsedCard {
  color: CardColor;
  value: CardValue;
  copy: number;
}

export function parseCard(id: CardId): ParsedCard {
  const [color, value, copy] = id.split(":");
  return { color: color as CardColor, value: value as CardValue, copy: Number(copy) };
}

export const colorOf = (id: CardId): CardColor => parseCard(id).color;
export const valueOf = (id: CardId): CardValue => parseCard(id).value;
/** "<colour>:<value>" without the copy number. */
export const faceOf = (id: CardId): string => id.slice(0, id.lastIndexOf(":"));
export const isWild = (id: CardId): boolean => colorOf(id) === "wild";
export const isNumber = (id: CardId): boolean => (NUMBER_VALUES as readonly string[]).includes(valueOf(id));

export function cardId(color: CardColor, value: CardValue, copy: number): CardId {
  return `${color}:${value}:${copy}`;
}

/** Points for scoring: numbers = face value, freeze/flip/plus2 = 20, wilds = 50. */
export function cardPoints(id: CardId): number {
  const v = valueOf(id);
  if (v === "rainbow" || v === "rainbow4") return 50;
  if (v === "freeze" || v === "flip" || v === "plus2") return 20;
  return Number(v);
}

export function handPoints(cards: readonly CardId[]): number {
  return cards.reduce((sum, c) => sum + cardPoints(c), 0);
}

/** All cards of `decks` decks (108 each), unshuffled. */
export function makeDeck(decks = 1): CardId[] {
  const out: CardId[] = [];
  for (const color of COLORS) {
    for (const v of NUMBER_VALUES) {
      const copies = (v === "0" ? 1 : 2) * decks;
      for (let k = 1; k <= copies; k++) out.push(cardId(color, v, k));
    }
    for (const v of ACTION_VALUES) for (let k = 1; k <= 2 * decks; k++) out.push(cardId(color, v, k));
  }
  for (const v of WILD_VALUES) for (let k = 1; k <= 4 * decks; k++) out.push(cardId("wild", v, k));
  return out;
}

/** Human name, e.g. "Sky 7", "Leaf Freeze", "Rainbow +4". */
export function cardLabel(id: CardId): string {
  const { color, value } = parseCard(id);
  if (color === "wild") return VALUE_LABEL[value];
  return `${COLOR_INFO[color].name} ${VALUE_LABEL[value]}`;
}

const COLOR_RANK: Record<CardColor, number> = { sun: 0, sky: 1, leaf: 2, berry: 3, wild: 4 };

/** Sorted copy: by colour then value ("color"), or by value then colour ("value"). */
export function sortHand(cards: readonly CardId[], by: "color" | "value" = "color"): CardId[] {
  const key = (id: CardId) => {
    const p = parseCard(id);
    const c = COLOR_RANK[p.color];
    const v = VALUE_ORDER.indexOf(p.value);
    return by === "color" ? c * 100 + v : v * 10 + c;
  };
  return cards.slice().sort((a, b) => key(a) - key(b) || parseCard(a).copy - parseCard(b).copy);
}

export function isColorId(x: unknown): x is ColorId {
  return typeof x === "string" && (COLORS as readonly string[]).includes(x);
}
