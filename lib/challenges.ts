export type ChallengeType = "math" | "typing";
export type Difficulty = "easy" | "medium" | "hard";

export type Challenge = {
  prompt: string;
  answer: string;
  /** Typing challenges at easy/medium forgive case and stray whitespace. */
  exact: boolean;
};

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pick = <T,>(items: readonly T[]) => items[rand(0, items.length - 1)];

const PHRASES: Record<Difficulty, readonly string[]> = {
  easy: [
    "wake up",
    "get up",
    "sun up",
    "no sleep",
    "move now",
    "stand up",
    "rise up",
    "lets go",
  ],
  medium: [
    "get out of bed",
    "the sun is up",
    "no more sleep",
    "start the day",
    "time to wake",
  ],
  hard: [
    "I am awake and I am getting up right now",
    "sleeping in is not part of the plan today",
    "the alarm has won and I accept my defeat",
    "put the phone down and stand up immediately",
  ],
};

function mathChallenge(difficulty: Difficulty): Challenge {
  if (difficulty === "easy") {
    const a = rand(2, 20);
    const b = rand(2, 20);
    const sub = Math.random() < 0.5;
    if (sub) {
      const big = Math.max(a, b);
      const small = Math.min(a, b);
      return { prompt: `${big} − ${small}`, answer: String(big - small), exact: true };
    }
    return { prompt: `${a} + ${b}`, answer: String(a + b), exact: true };
  }

  if (difficulty === "medium") {
    const a = rand(10, 49);
    const b = rand(10, 49);
    const sub = Math.random() < 0.5;
    if (sub) {
      const big = Math.max(a, b);
      const small = Math.min(a, b);
      return { prompt: `${big} − ${small}`, answer: String(big - small), exact: true };
    }
    return { prompt: `${a} + ${b}`, answer: String(a + b), exact: true };
  }

  const a = rand(12, 29);
  const b = rand(3, 9);
  const c = rand(10, 60);
  return {
    prompt: `${a} × ${b} + ${c}`,
    answer: String(a * b + c),
    exact: true,
  };
}

function typingChallenge(difficulty: Difficulty): Challenge {
  const phrase = pick(PHRASES[difficulty]);
  return { prompt: phrase, answer: phrase, exact: difficulty === "hard" };
}

export function makeChallenge(
  type: ChallengeType,
  difficulty: Difficulty
): Challenge {
  return type === "math"
    ? mathChallenge(difficulty)
    : typingChallenge(difficulty);
}

export function isCorrect(challenge: Challenge, input: string): boolean {
  if (challenge.exact) return input.trim() === challenge.answer;
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return normalize(input) === normalize(challenge.answer);
}
