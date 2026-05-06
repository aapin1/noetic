const STOPWORDS = new Set([
  "the","a","an","and","or","but","is","are","was","were","be","been","being",
  "have","has","had","do","does","did","will","would","should","could","may","might",
  "i","you","he","she","it","we","they","them","his","her","their","this","that",
  "these","those","of","in","on","at","to","for","with","by","from","as","into",
  "about","over","after","before","between","against","during","without","within",
  "so","than","because","while","when","where","who","why","how","what",
  "all","any","each","few","more","most","other","some","such","no","not",
  "only","own","same","too","very","just","now","also","then",
  "one","two","three","first","last","new","good","bad",
  "can","said","says","like","get","got","make","made","much","many",
  "http","https","www","com","org","net","html","amp","via","ref",
  "your","yours","mine","ours","its","there","here","out","up","down",
  "off","both","through","again","further","once","still",
  "im","ive","youre","theyre","dont","didnt","cant","wont","ill","were",
]);

const NEGATION_TOKENS = new Set([
  "not","no","never","without","against","contrary","oppose","opposed","reject",
  "rejects","rejected","wrong","false","disagree","unlike","contradict","contradicts",
  "deny","denies","fails","failure","fail","mistake","myth","debunk","debunked",
]);

const AFFIRMATION_TOKENS = new Set([
  "always","clearly","obvious","obviously","prove","proves","proven","confirm",
  "confirmed","support","supports","supported","agree","agrees","correct","right",
  "true","truth","valid","success","succeeds","works","work","effective",
]);

export type TermVector = Record<string, number>;

export function tokenize(text: string): string[] {
  if (!text) {
    return [];
  }

  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^['-]+|['-]+$/g, ""))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

export function bigrams(tokens: string[]): string[] {
  const out: string[] = [];

  for (let i = 0; i < tokens.length - 1; i += 1) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }

  return out;
}

function l2Normalize(vector: TermVector): TermVector {
  const norm = Math.sqrt(Object.values(vector).reduce((sum, value) => sum + value * value, 0));

  if (norm === 0) {
    return vector;
  }

  const next: TermVector = {};

  for (const [key, value] of Object.entries(vector)) {
    next[key] = value / norm;
  }

  return next;
}

export function termFrequency(tokens: string[], unigramWeight = 1, bigramWeight = 1.6): TermVector {
  const tf: TermVector = {};

  for (const token of tokens) {
    tf[token] = (tf[token] ?? 0) + unigramWeight;
  }

  for (const phrase of bigrams(tokens)) {
    tf[phrase] = (tf[phrase] ?? 0) + bigramWeight;
  }

  return l2Normalize(tf);
}

export function cosine(a: TermVector, b: TermVector): number {
  const [smaller, larger] = Object.keys(a).length < Object.keys(b).length ? [a, b] : [b, a];
  let dot = 0;

  for (const [key, value] of Object.entries(smaller)) {
    const other = larger[key];

    if (other) {
      dot += value * other;
    }
  }

  return dot;
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const left = new Set(a);
  const right = new Set(b);

  if (left.size === 0 && right.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const item of left) {
    if (right.has(item)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;

  if (union === 0) {
    return 0;
  }

  return intersection / union;
}

export function topTerms(vector: TermVector, n = 8): { term: string; weight: number }[] {
  return Object.entries(vector)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([term, weight]) => ({ term, weight }));
}

export function polarity(tokens: string[]): { negation: number; affirmation: number } {
  let negation = 0;
  let affirmation = 0;

  for (const token of tokens) {
    if (NEGATION_TOKENS.has(token)) {
      negation += 1;
    }

    if (AFFIRMATION_TOKENS.has(token)) {
      affirmation += 1;
    }
  }

  const total = Math.max(tokens.length, 1);
  return {
    negation: negation / total,
    affirmation: affirmation / total,
  };
}

export function extractiveSummary(text: string, maxSentences = 2): string {
  if (!text) {
    return "";
  }

  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[\.!?])\s+(?=[A-Z0-9"'\(])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length === 0) {
    return text.slice(0, 240).trim();
  }

  if (sentences.length <= maxSentences) {
    return sentences.join(" ");
  }

  const corpusVector = termFrequency(tokenize(sentences.join(" ")));
  const scored = sentences.map((sentence, index) => {
    const sentenceVector = termFrequency(tokenize(sentence));
    const positionBoost = index === 0 ? 1.15 : index === 1 ? 1.05 : 1;
    return {
      sentence,
      score: cosine(sentenceVector, corpusVector) * positionBoost,
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence))
    .map((item) => item.sentence)
    .join(" ");
}

export function extractKeyIdea(text: string): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[\.!?])\s+(?=[A-Z0-9"'\(])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length === 0) {
    return text.slice(0, 160).trim();
  }

  const corpusVector = termFrequency(tokenize(sentences.join(" ")));
  let best = sentences[0];
  let bestScore = -1;

  for (const sentence of sentences) {
    const tokens = tokenize(sentence);

    if (tokens.length < 4 || tokens.length > 30) {
      continue;
    }

    const score = cosine(termFrequency(tokens), corpusVector);

    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }

  return best;
}
