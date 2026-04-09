import type { Country } from '../data/countries';
import type { ModeAdapter, PromptData, QuizVariant } from '../engine/types';

// ─── Mode 1: Click & Type ───────────────────────────────────────
export class ClickAndTypeMode implements ModeAdapter {
  readonly requiresMapClick = true;
  readonly modeName = 'Click & Type';

  getPrompt(country: Country): PromptData {
    return { type: 'click', country, text: 'Name this country or select another' };
  }

  getAnswer(country: Country): string[] {
    return country.acceptedNames;
  }

  getDisplayAnswer(country: Country): string {
    return country.name;
  }
}

// ─── Mode 2: Free Type ──────────────────────────────────────────
export class FreeTypeMode implements ModeAdapter {
  readonly requiresMapClick = false;
  readonly modeName = 'Free Type';

  getPrompt(): PromptData {
    return { type: 'text', text: 'Type any country name' };
  }

  getAnswer(country: Country): string[] {
    return country.acceptedNames;
  }

  getDisplayAnswer(country: Country): string {
    return country.name;
  }
}

// ─── Helper: pick N random wrong answers ────────────────────────
function pickWrongAnswers(
  correct: Country,
  pool: Country[],
  count: number,
  getLabel: (c: Country) => string
): { labels: string[]; items: Country[] } {
  const others = pool.filter((c) => c.id !== correct.id);
  const shuffled = [...others].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, count);
  return {
    labels: picked.map(getLabel),
    items: picked,
  };
}

function shuffleWithCorrect(
  correctLabel: string,
  correctItem: Country,
  wrongLabels: string[],
  wrongItems: Country[]
): { labels: string[]; items: Country[] } {
  const combined = wrongLabels.map((l, i) => ({
    label: l,
    item: wrongItems[i],
  }));
  combined.push({ label: correctLabel, item: correctItem });
  combined.sort(() => Math.random() - 0.5);
  return {
    labels: combined.map((c) => c.label),
    items: combined.map((c) => c.item),
  };
}

// ─── Mode 3: Flag Quiz ──────────────────────────────────────────
export class FlagQuizMode implements ModeAdapter {
  readonly requiresMapClick = false;
  readonly modeName = 'Flag Quiz';
  variant: QuizVariant;
  constructor(variant: QuizVariant) {
    this.variant = variant;
  }

  getPrompt(country: Country, allCountries: Country[]): PromptData {
    if (this.variant === 'multiple-choice') {
      const wrong = pickWrongAnswers(country, allCountries, 2, (c) => c.name);
      const { labels } = shuffleWithCorrect(
        country.name, country, wrong.labels, wrong.items
      );
      return { type: 'flag', country, choices: labels };
    }

    if (this.variant === 'match-flag') {
      const wrong = pickWrongAnswers(country, allCountries, 2, (c) => c.name);
      const { items } = shuffleWithCorrect(
        country.name, country, wrong.labels, wrong.items
      );
      return { type: 'text', country, text: country.name, choiceItems: items };
    }

    // Free: show flag, type name
    return { type: 'flag', country };
  }

  getAnswer(country: Country): string[] {
    return country.acceptedNames;
  }

  getDisplayAnswer(country: Country): string {
    return country.name;
  }
}

// ─── Mode 5: Capital Quiz ───────────────────────────────────────
export class CapitalQuizMode implements ModeAdapter {
  readonly requiresMapClick = false;
  readonly modeName = 'Capital Quiz';
  variant: QuizVariant;
  constructor(variant: QuizVariant) {
    this.variant = variant;
  }

  getPrompt(country: Country, allCountries: Country[]): PromptData {
    if (this.variant === 'multiple-choice') {
      const wrong = pickWrongAnswers(country, allCountries, 2, (c) => c.capital);
      const { labels } = shuffleWithCorrect(
        country.capital, country, wrong.labels, wrong.items
      );
      return { type: 'text', country, text: country.name, choices: labels };
    }

    if (this.variant === 'match-flag') {
      const wrong = pickWrongAnswers(country, allCountries, 2, (c) => c.name);
      const { labels } = shuffleWithCorrect(
        country.name, country, wrong.labels, wrong.items
      );
      return { type: 'text', country, text: country.capital, choices: labels };
    }

    // Free: show country name + highlight on map, type capital
    return { type: 'map-highlight', country, text: country.name };
  }

  getAnswer(country: Country): string[] {
    return country.acceptedCapitals;
  }

  getDisplayAnswer(country: Country): string {
    return country.capital;
  }
}
