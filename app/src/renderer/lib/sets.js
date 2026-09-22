/**
 * Sets of things, and the pictures that compare them.
 *
 * A list of gene names per condition is the commonest table in biology that is
 * not a table of numbers at all. Two or three such lists make a Venn diagram;
 * more than that make a Venn diagram nobody can read, which is what UpSet
 * plots were invented for.
 *
 * The counting here is deliberately plain, because the mistake people make
 * with these figures is not arithmetic: it is showing an overlap of 40 genes
 * without saying whether 40 is more than chance would give. So a two-set
 * comparison also carries Fisher's exact test against a stated background.
 */

import { fisherExact } from "./stats";

/**
 * The sets in a dataset: one per column, the cells being the members.
 *
 * Blank cells are not members, and a name repeated in one column is one
 * member, since a set holds a thing once.
 */
export function readSets(dataset) {
  return (dataset?.columns ?? []).map((column, i) => {
    const members = new Set();
    for (const value of column.values) {
      const name = String(value ?? "").trim();
      if (name !== "") members.add(name);
    }
    return { name: column.name || `Set ${i + 1}`, members, size: members.size, col: i };
  });
}

/** Everything that is in at least one set, in the order first met. */
export function universe(sets) {
  const all = [];
  const seen = new Set();
  for (const set of sets) {
    for (const member of set.members) {
      if (!seen.has(member)) {
        seen.add(member);
        all.push(member);
      }
    }
  }
  return all;
}

/**
 * Which sets each member belongs to, as a pattern of true and false in the
 * order the sets were given.
 */
export function membership(sets) {
  return universe(sets).map((member) => ({
    member,
    pattern: sets.map((set) => set.members.has(member)),
  }));
}

/**
 * Every region of a Venn diagram that has anything in it: the members that are
 * in exactly this combination of sets and no others.
 *
 * `key` is a string of 1 and 0 in set order, which is what the drawing uses to
 * find where to put the number.
 */
export function vennRegions(sets) {
  const regions = new Map();
  for (const { member, pattern } of membership(sets)) {
    const key = pattern.map((inside) => (inside ? "1" : "0")).join("");
    if (!regions.has(key)) regions.set(key, { key, pattern, members: [] });
    regions.get(key).members.push(member);
  }
  return [...regions.values()]
    .map((region) => ({ ...region, count: region.members.length }))
    .sort((a, b) => b.count - a.count);
}

/**
 * The bars of an UpSet plot: each combination of sets, with how many members
 * belong to exactly that combination.
 *
 * "exclusive" counts a member once, in the combination it truly belongs to,
 * which is the usual reading and the one that adds up to the total.
 * "inclusive" counts a member in every combination it satisfies, which is what
 * people mean when they say "the overlap of A and B" without excluding C.
 */
export function upsetIntersections(sets, { mode = "exclusive", limit = 20, sort = "size" } = {}) {
  const rows = membership(sets);
  const combinations = new Map();
  const add = (indices, member) => {
    if (indices.length === 0) return;
    const key = indices.join(",");
    if (!combinations.has(key)) combinations.set(key, { key, sets: indices, members: [] });
    combinations.get(key).members.push(member);
  };

  for (const { member, pattern } of rows) {
    const indices = pattern.map((inside, i) => (inside ? i : -1)).filter((i) => i >= 0);
    if (mode === "exclusive") {
      add(indices, member);
      continue;
    }
    // Inclusive: every non-empty subset of the sets this member is in.
    const total = 1 << indices.length;
    for (let mask = 1; mask < total; mask += 1) {
      add(indices.filter((_, bit) => mask & (1 << bit)), member);
    }
  }

  const all = [...combinations.values()].map((c) => ({ ...c, count: c.members.length }));
  const ordered = [...all].sort((a, b) => {
    if (sort === "sets") return a.sets.length - b.sets.length || b.count - a.count;
    return b.count - a.count || a.sets.length - b.sets.length;
  });
  return { intersections: ordered.slice(0, Math.max(1, limit)), hidden: Math.max(0, ordered.length - limit), mode };
}

/**
 * Is the overlap between two sets more than chance would give?
 *
 * Fisher's exact test on the four counts: in both, in one only, in the other
 * only, and in neither. The last of those needs a background: how many things
 * could have been in a list at all, which is the number of genes tested, not
 * the number that came out. Without one there is no test to do, so the caller
 * is told to say what it is rather than being handed a made-up number.
 */
export function overlapTest(a, b, background) {
  const both = [...a.members].filter((m) => b.members.has(m)).length;
  const onlyA = a.size - both;
  const onlyB = b.size - both;
  const union = a.size + b.size - both;
  const jaccard = union > 0 ? both / union : NaN;
  const expected = background > 0 ? (a.size * b.size) / background : NaN;
  if (!(background > 0)) {
    return { both, onlyA, onlyB, jaccard, expected: NaN, error: "Say how many things were tested to test the overlap." };
  }
  if (background < union) {
    return { both, onlyA, onlyB, jaccard, expected, error: "The background is smaller than the two lists together." };
  }
  const neither = background - union;
  const { p, oddsRatio } = fisherExact([
    [both, onlyA],
    [onlyB, neither],
  ]);
  return {
    both,
    onlyA,
    onlyB,
    neither,
    jaccard,
    expected,
    enrichment: expected > 0 ? both / expected : NaN,
    oddsRatio,
    p,
    background,
  };
}
