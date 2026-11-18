/**
 * A made-up discrete maths course shaped like the owner's real spaces (by
 * their counts only): 32 topics of 4 to 20 facts (median 13), 420 facts with
 * short names (median 4 words), about 0.65 links per fact inside a topic on
 * about two thirds of its facts, a few topics with only 1 to 3 links, about as
 * many links across topics as inside. Most facts never answered; one topic
 * well studied and one half studied. Deterministic.
 */
import { rampColor, tally, topicStatus, type AnswerOutcome, type AnswerRef, type FactProgress, type TopicLink, type TopicProgress } from "../src/shared/core/index.ts";
import { rng, type Space } from "./constellation-fixture.ts";

/** Each topic: name, share answered, skill (0 to 1), links inside it (null: about 0.65 per fact), fact names. */
const TOPICS: [string, number, number, number | null, string][] = [
	["Sets", 0.1, 0.6, null, "Sets ignore order|Sets ignore repeats|Empty set is unique|Empty set is in every set|Subsets of a finite set|Power set has 2^n members|Set builder notation|Equal sets share elements|Proper subsets leave something out|The universal set holds everything|Cardinality of a set|Infinite sets can differ in size|Countable sets list one by one|Naturals are countable|Reals are uncountable|Ordered pairs differ from sets"],
	["Set operations", 0.1, 0.55, null, "Union keeps either|Intersection keeps both|Set difference removes the second set|Complement needs a universe|De Morgan for sets|Disjoint sets share nothing|Cartesian product pairs every element|Size of a product|Distributive laws for sets|Symmetric difference keeps one side only|Venn diagrams show every overlap|Partitions of a set"],
	["Logic", 0.15, 0.55, null, "Implication truth table|Contrapositive is equivalent|Converse is not equivalent|Inverse is not equivalent|Biconditional needs equal truth values|Exclusive or wants exactly one|Tautologies are always true|Contradictions are always false|Equivalent formulas share a truth table|Truth tables have 2^n rows|De Morgan for logic|Implication as not p or q|False hypotheses make vacuous truths|Modus ponens draws the conclusion|Modus tollens denies the hypothesis|Disjunctive syllogism drops a false option|And, or and not express everything"],
	["Quantifiers", 0.1, 0.5, null, "For all claims need every case|There exists needs one witness|Negating for all|Negating there exists|Order of quantifiers matters|Nested quantifiers read left to right|Domain of discourse|Bound and free variables|Unique existence needs exactly one|Predicates become statements"],
	["Proof methods", 0.1, 0.5, null, "Direct proof goes hypothesis to conclusion|Proof by contrapositive|Proof by contradiction|Proof by cases|One counterexample disproves for all|Existence proofs show one object|Constructive proofs build the object|Uniqueness proofs equate two solutions|Without loss of generality|If and only if needs two directions|Root two is irrational|Parity arguments split even and odd|Examples never prove all|Unpack definitions first|Combinatorial proofs count one set twice|Double counting equates two counts|Infinitely many primes|Proof by exhaustion"],
	["Induction", 0.15, 0.5, null, "The base case starts the chain|The inductive step moves n to n+1|The hypothesis assumes the claim for n|Sum of first n integers|Sum of a geometric series|Wrong base case|Induction for inequalities|2^n beats n|Divisibility by induction|Recursive definitions pair with induction|Structural induction follows how objects build|Several base cases|Where the hypothesis is used|Well ordering principle|Induction on n plus one"],
	["Strong induction", 0.05, 0.5, null, "Assume all smaller cases|Prime factorization exists|Postage stamp problem|Strong equals weak induction|Fibonacci numbers stay below 2^n|Games by strong induction"],
	["Functions", 0.08, 0.6, null, "One output per input|Injective means no two inputs collide|Surjective means every output is hit|Bijective is injective and surjective|Inverse needs a bijection|Composition of functions|Composition of injections|Composition of surjections|Image and preimage|Floor and ceiling|Functions from m to n number n^m|Injections number n!/(n-m)!|Equal size via bijection|The identity function changes nothing"],
	["Relations", 0.05, 0.55, null, "Relation as a subset|Reflexive relates each element to itself|Symmetric relations work both ways|Antisymmetric forbids two-way pairs|Transitive relations chain pairs|The inverse relation flips each pair|Composite relations follow two steps|Relation matrices mark related pairs|Digraphs draw a relation as arrows|Closure of a relation|Number of relations on a set"],
	["Equivalence relations", 0.05, 0.55, null, "Reflexive symmetric transitive|Equivalence classes group related elements|Classes partition the set|Congruence mod n|Representatives of classes|Partitions give relations|Quotient sets collect the classes|Counting equivalence classes"],
	["Partial orders", 0.0, 0.5, null, "Reflexive antisymmetric transitive|Hasse diagrams drop implied edges|Total orders compare every pair|Maximal and minimal|Greatest and least|Lexicographic order compares like a dictionary|Topological sorting extends a partial order"],
	["Sum rule", 0.1, 0.65, null, "Add disjoint cases|Overlap breaks the sum rule|Cases must be disjoint|Split by first choice|Sum rule as set union|Counting by cases|Subtract the overlap|Count the complement when it is easier|Either or counting"],
	["Product rule", 0.15, 0.65, null, "Multiply sequential choices|Strings of length n|Passwords with a digit|License plates multiply each position|Choices may depend on earlier ones|Tree diagrams list sequential outcomes|Count subsets by product|Product rule as Cartesian product|Handle restrictions before free choices|The division rule removes symmetric copies|Seating around a table|Counting functions uses the product rule|Bit strings of length n"],
	["Permutations", 0.9, 0.82, null, "Order matters in a permutation|n objects have n! orderings|r of n in order|Zero factorial is one|Circular arrangements divide by n|Repeated letters divide|MISSISSIPPI divides by repeated letters|Glue adjacent objects|Keep objects apart|Fixed seats versus circles|Necklaces also divide by flips|Derangements move every object|Derangements tend to n!/e|Anagrams permute a word's letters|Top three of ten runners|Factorials outgrow powers|Restricted positions first|Permutations of a multiset"],
	["Combinations", 0.12, 0.55, null, "n choose k|Choose k or leave n minus k|Committees ignore order|Committee with a chair|Lattice paths choose the right steps|Poker hands choose 5 of 52|At least one by complement|Vandermonde splits a choice in two|Rows sum to powers of two|Symmetry of binomials|Hockey stick identity|Overcounting the same subset|Bit strings with k ones|Choose then arrange|Choosing positions uses combinations, not permutations|Combinations with repetition|Subsets of size at most k|Pairs among n people|n people make n choose 2 handshakes|Counting committees with a required member"],
	["Binomial theorem", 0.05, 0.5, null, "Expanding (x+y)^n gives binomials|Coefficients are binomials|Alternating sum is zero|The general term picks k factors|Coefficient of x^k|Constants multiply coefficients|Middle coefficient is largest|The multinomial theorem allows more terms|Proof by Pascal's rule|Each coefficient counts choices|Even and odd subsets|Binomial with negative terms"],
	["Pascal's triangle", 0.05, 0.5, null, "Pascal's rule adds the two above|Edges are ones|Rows are symmetric|Each row sums to a power of two|Diagonals give hockey sticks|Odd entries make Sierpinski|Row n has n plus one entries|Triangle from paths"],
	["Stars and bars", 0.5, 0.6, null, "Identical items into bins|Nonnegative solutions use n+k-1 choose k|Positive solutions shift by one|Bars between stars|Upper bounds need exclusion|Distinct items are not stars and bars|Donuts of k kinds|Integer solutions with bounds|Multisets of size k|Lower bounds subtract first"],
	["Pigeonhole", 0.1, 0.45, null, "More pigeons than holes|Some hole gets the ceiling of n/k|Ceiling of n over k|Choosing the holes|Thirteen people share a month|Same remainder mod n|Points in a square|Socks in the dark|Long sequences hide monotone runs|Repeated subset sums|Existence without a pair|Equal pigeons and holes fail|Friends at a party"],
	["Inclusion-exclusion", 0.06, 0.4, null, "Two sets subtract the overlap once|Three sets have seven terms|Signs alternate with the number of sets|None of the sets|Divisible by none|Derangements by exclusion|Counting surjections from an n-set onto a k-set takes an alternating sum|Euler's phi follows from exclusion|Each element counted once|Symmetric cases collapse|Bounded stars and bars|k sets at a time|The general formula sums all intersections|Count elements in none of the sets|Sieve of Eratosthenes|Onto functions exclude missed outputs|Exclusion with bounds"],
	["Recurrences", 0.05, 0.5, null, "Terms from earlier terms|Initial conditions pin one solution|Fibonacci adds the two previous terms|The characteristic equation gives the roots|Repeated roots multiply by n|Tower of Hanoi|No two consecutive ones|Particular solutions handle the extra term|Unrolling a recurrence reveals a pattern|Divide and conquer|The master theorem bounds divide and conquer|Catalan numbers count balanced parentheses|Catalan numbers satisfy a convolution|Check the first terms|Tilings of a strip|Derangements use the two previous values|Guess then prove|Linear homogeneous recurrences have closed forms|Order of a recurrence"],
	["Generating functions", 0.0, 0.5, null, "Power series as counters|Ordinary generating functions|Product counts pairs|A geometric series sums to 1/(1-x)|Generating functions solve recurrences|Read the answer off a coefficient|Partitions of integers|Exponential generating functions|Shifting a sequence"],
	["Asymptotics", 0.1, 0.5, null, "Big O is an upper bound|Big Omega is a lower bound|Big Theta bounds both sides|Constants do not matter|Lower terms drop|Logs of any base|Polynomials beat logs|Exponentials beat polynomials|Factorials grow faster than exponentials|Stirling's formula approximates n!|Sums of powers|Harmonic numbers grow like log n|Limits decide order"],
	["Algorithm analysis", 0.08, 0.55, null, "Count basic steps|Worst case takes the slowest input|Best case takes the fastest input|Average case weighs inputs by chance|Nested loops multiply|Loops that halve|Binary search is log n|Merge sort is n log n|Insertion sort is n^2|Recursion trees sum the work per level|Loop invariants prove loops correct|Correctness by induction|Space complexity counts extra memory|Amortized cost averages over a sequence|Sorting lower bound|Sorting cost counts comparisons|Selection sort always takes n^2|Linear search checks every element"],
	["Probability basics", 0.06, 0.5, 3, "The sample space lists every outcome|Events are subsets|Equally likely outcomes|Favorable over total|The complement rule subtracts from one|Union of events|Disjoint events add|Probability axioms start at zero and one|Two dice sums are not uniform|Coin flips double the outcomes|Card hands divide combinations|23 people likely share a birthday|With and without replacement|Counting for probability|Uniform outcomes are equally likely|Odds versus probability|Switching doors wins two thirds|Random bit strings|Lottery odds divide by n choose k"],
	["Conditional probability", 0.05, 0.5, null, "Conditioning shrinks the space|Product rule for events|Independent events multiply|Independent is not disjoint|Bayes' rule reverses the condition|Law of total probability|Tree diagrams for events|Rare conditions give many false positives|Pairwise versus mutual|Conditioning on unions|The chain rule multiplies conditionals|Base rate fallacy"],
	["Expected value", 0.08, 0.5, null, "Expectation is a weighted average|Linearity of expectation|No independence needed|Indicator variables turn counts into sums|Expected fixed points is one|Expected dice sum|Variance measures spread from the mean|Variance of a sum|Bernoulli trials have two outcomes|The binomial counts successes in n trials|The geometric counts trials to success|Expected trials to success|Collecting n coupons takes n log n|Markov bounds the chance of large values|Chebyshev bounds distance from the mean|A random permutation has n(n-1)/4 inversions"],
	["Graphs", 0.08, 0.55, null, "Vertices and edges|Degree sum is twice edges|Odd vertices come in pairs|Paths and cycles|Connected graphs have paths between all|Complete graphs have n choose 2 edges|Bipartite graphs split into two sides|No odd cycles if bipartite|Euler circuits need all degrees even|Euler paths allow two odd vertices|Hamiltonian cycles have no easy test|An adjacency matrix marks each edge|Isomorphic graphs relabel the same shape|Equal degree sequences do not prove isomorphism|Subgraphs keep some vertices and edges|Planar graphs draw without crossings|Planar graphs satisfy v - e + f = 2|Directed graphs give edges a direction|The handshake lemma counts edge ends"],
	["Trees", 0.08, 0.55, null, "n minus one edges|One path between vertices|Adding an edge makes a cycle|Every tree with an edge has two leaves|Spanning trees reach every vertex|Rooted trees give every vertex a parent|Binary trees have at most two children|Cayley counts n^(n-2) labeled trees|Traversals visit nodes in a fixed order|Height and depth|Full binary trees|Removing a leaf|Prufer codes encode labeled trees"],
	["Graph coloring", 0.0, 0.5, 1, "Proper colorings give neighbours different colors|The chromatic number is the fewest colors|Bipartite needs two|Four color theorem|Greedy coloring uses at most max degree + 1"],
	["Modular arithmetic", 0.1, 0.5, null, "Congruence mod n|Adding mod n|Multiplying mod n|Remainders lie between 0 and n-1|The division algorithm gives quotient and remainder|Inverses mod n|Inverse needs gcd one|Euclid's algorithm finds the gcd|Extended Euclid writes the gcd as a combination|Fermat's little theorem|Square and multiply speeds up powers|Chinese remainder theorem|Last digits come from mod 10|Divisibility by 3 sums the digits|Clock arithmetic wraps at n|Negative numbers still have positive remainders|Linear congruences solve with an inverse"],
	["Number theory", 0.0, 0.5, 2, "Primes have exactly two divisors|Fundamental theorem of arithmetic|gcd and lcm|Coprime numbers share no factor"],
];

/** Topic links: learn the first before the second. */
const NEEDS: [string, string][] = [
	["Sets", "Set operations"], ["Sets", "Functions"], ["Set operations", "Sum rule"], ["Set operations", "Inclusion-exclusion"],
	["Logic", "Quantifiers"], ["Logic", "Proof methods"], ["Quantifiers", "Proof methods"], ["Proof methods", "Induction"],
	["Induction", "Strong induction"], ["Functions", "Relations"], ["Relations", "Equivalence relations"], ["Relations", "Partial orders"],
	["Sum rule", "Product rule"], ["Product rule", "Permutations"], ["Permutations", "Combinations"], ["Combinations", "Binomial theorem"],
	["Combinations", "Pascal's triangle"], ["Pascal's triangle", "Binomial theorem"], ["Combinations", "Stars and bars"], ["Functions", "Pigeonhole"],
	["Combinations", "Inclusion-exclusion"], ["Stars and bars", "Inclusion-exclusion"], ["Induction", "Recurrences"], ["Recurrences", "Generating functions"],
	["Binomial theorem", "Generating functions"], ["Functions", "Asymptotics"], ["Asymptotics", "Algorithm analysis"], ["Recurrences", "Algorithm analysis"],
	["Combinations", "Probability basics"], ["Probability basics", "Conditional probability"], ["Probability basics", "Expected value"], ["Conditional probability", "Expected value"],
	["Relations", "Graphs"], ["Graphs", "Trees"], ["Graphs", "Graph coloring"], ["Strong induction", "Trees"],
	["Equivalence relations", "Modular arithmetic"], ["Modular arithmetic", "Number theory"], ["Proof methods", "Number theory"], ["Permutations", "Expected value"],
];

const FILES = Array.from({ length: 40 }, (_, i) => `src_file_${i + 1}`);
const LESSONS = Array.from({ length: 12 }, (_, i) => `chat_lesson_${i + 1}`);

/** About 0.65 links per fact inside a topic. */
const LINKS_PER_FACT = 0.65;

export function realCourse(): Space {
	const r = rng(43);
	const topics: TopicProgress[] = [];
	const facts: FactProgress[] = [];
	const chains: Space["chains"] = [];
	const ids = new Map<string, string>();
	let clock = Date.parse("2026-09-24T17:00:00Z");
	const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
	const answer = (fid: string, i: number, skill: number): AnswerRef => {
		const p = Math.min(0.95, skill + 0.06 * i);
		const x = r();
		const outcome: AnswerOutcome = x < p ? "right" : x < p + 0.1 ? "hinted" : x < p + 0.18 ? "dontKnow" : "wrong";
		clock += 3600_000 * (2 + Math.floor(r() * 30));
		return { chatId: pick(LESSONS), toolCallId: `${fid}_${i}`, outcome, answeredAt: new Date(clock).toISOString() };
	};
	let inside = 0;
	TOPICS.forEach(([name, share, skill, linkCount, list], ti) => {
		const id = `tpc_${name.toLowerCase().replace(/\W+/g, "_")}`;
		ids.set(name, id);
		const names = list.split("|");
		const myFiles = Array.from({ length: 3 }, (_, j) => FILES[(ti + j * 13) % FILES.length]!);
		const myLessons = [LESSONS[ti % 12]!, LESSONS[(ti + 5) % 12]!];
		const studied = share > 0.7;
		const mine: FactProgress[] = names.map((fname, k) => {
			const fid = `${id}_f${k}`;
			const answered = r() < share;
			const n = !answered ? 0 : studied ? 2 + Math.floor(r() ** 1.3 * 9) : r() < 0.85 ? 1 + Math.floor(r() * 3) : 5 + Math.floor(r() * 3);
			const answers = Array.from({ length: n }, (_, i) => answer(fid, i, skill));
			const inLessons = n > 0 || r() < (studied ? 0.9 : 0.25);
			const lessons = inLessons ? myLessons.slice(0, 1 + (r() < 0.35 ? 1 : 0)) : [];
			const born = inLessons && r() < 0.5 ? lessons[0]! : pick(myFiles);
			return { id: fid, name: fname, statement: `${fname}.`, topicId: id, born, inLessons, answers };
		});
		// Links inside: about two thirds of the facts take part, as one or two trees with a few extra links.
		const want = linkCount ?? Math.max(1, Math.round(LINKS_PER_FACT * mine.length));
		const order = [...mine].sort(() => r() - 0.5);
		const linked = order.slice(0, Math.min(mine.length, linkCount !== null ? linkCount + 1 : Math.max(2, Math.round((2 / 3) * mine.length))));
		const seen = new Set<string>();
		let made = 0;
		const add = (p: FactProgress, c: FactProgress) => {
			const key = `${p.id}>${c.id}`;
			if (p === c || seen.has(key) || seen.has(`${c.id}>${p.id}`)) return;
			seen.add(key);
			chains.push({ premises: [p.id], conclusion: c.id });
			made++;
		};
		for (let i = 1; i < linked.length && made < want; i++) add(pick(linked.slice(0, i)), linked[i]!);
		for (let tries = 0; made < want && tries < 200; tries++) {
			const i = 1 + Math.floor(r() * (linked.length - 1));
			add(pick(linked.slice(0, i)), linked[i]!);
		}
		inside += made;
		facts.push(...mine);
		const all = mine.flatMap((f) => f.answers).sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
		const t = tally(all);
		topics.push({ id, name, members: mine.map((f) => f.id), ...t, status: topicStatus(t.rate), color: rampColor(t.rate), overconfident: false, answers: all, column: 0 });
	});
	// About as many links cross topics as stay inside, spread over the topic links.
	const byId = new Map(topics.map((t) => [t.id, t]));
	const per = Math.round(inside / NEEDS.length);
	const links: TopicLink[] = NEEDS.map(([a, z]) => {
		const from = byId.get(ids.get(a)!)!;
		const to = byId.get(ids.get(z)!)!;
		const n = Math.max(1, per - 2 + Math.floor(r() * 5));
		for (let i = 0; i < n; i++) chains.push({ premises: [pick(from.members)], conclusion: pick(to.members) });
		return { from: from.id, to: to.id, weight: n };
	});
	const col = (id: string, seen = new Set<string>()): number => {
		if (seen.has(id)) return 0;
		seen.add(id);
		const ins = links.filter((l) => l.to === id);
		return ins.length ? 1 + Math.max(...ins.map((l) => col(l.from, new Set(seen)))) : 0;
	};
	for (const t of topics) t.column = col(t.id);
	return { topics, links, facts, chains };
}
