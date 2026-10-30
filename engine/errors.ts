/** Thrown for any rule violation. The message is shown to the player, so keep it short and friendly. */
export class GameError extends Error {
  readonly isGameError = true;
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}

/** Throw a GameError. Use in reduce() for illegal actions: `if (!ok) fail("Follow suit")`. */
export function fail(message: string): never {
  throw new GameError(message);
}

/** Throw a GameError unless `condition` holds. */
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new GameError(message);
}

export function isGameError(e: unknown): e is GameError {
  return typeof e === "object" && e !== null && (e as { isGameError?: boolean }).isGameError === true;
}
