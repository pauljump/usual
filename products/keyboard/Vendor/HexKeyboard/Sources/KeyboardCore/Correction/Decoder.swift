/// How well one tap fits each letter: log densities per square point, indexed a–z then the apostrophe, plus the
/// density of a stray tap (one that meant no letter at all), and where it landed.
public struct TapEvidence: Hashable, Sendable {
    public var letters: [Double]
    public var stray: Double
    public var point: Tap?

    public init(letters: [Double], stray: Double, point: Tap? = nil) {
        self.letters = letters
        self.stray = stray
        self.point = point
    }

    static func exact(_ letter: UInt8) -> TapEvidence {
        var letters = [Double](repeating: -.infinity, count: Lexicon.alphabet)
        if let index = Lexicon.index(of: letter) { letters[index] = 0 }
        return TapEvidence(letters: letters, stray: -.infinity)
    }

    var best: Double { letters.max() ?? 0 }
}

/// Finds the words a sequence of taps most likely meant: exact A* over the lexicon trie, scoring each word as
/// P(taps | word) × P(word). A word may differ by one missed, extra or swapped tap (about 1 in 100 keystrokes), and
/// typing a contraction's apostrophe is a coin flip. Each node's subtree mass bounds every word below it, so the
/// search finds the best words first.
struct Decoder {
    let lexicon: Lexicon

    static let editLogProbability = Math.log(0.01)
    static let apostropheLogProbability = Math.log(0.5)
    static let budget = 6000

    struct Result: Hashable {
        var word: String
        var logLikelihood: Double
        var logPrior: Double
        var isCompletion: Bool
    }

    private struct State {
        var node: Lexicon.Node
        var tap: Int
        var edits: Int
        var completing: Bool
        var score: Double
        var spelling: Int
        var terminal: Bool
    }

    /// Spellings as a trail of letters, each pointing at the spelling it extends, so a search step costs no allocation.
    private struct Trail {
        private var steps: [(previous: Int, letter: UInt8)] = []

        static let empty = -1

        mutating func extend(_ spelling: Int, with letter: UInt8) -> Int {
            steps.append((spelling, letter))
            return steps.count - 1
        }

        func word(_ spelling: Int) -> String {
            var letters: [UInt8] = []
            var step = spelling
            while step != Self.empty {
                letters.append(steps[step].letter)
                step = steps[step].previous
            }
            return String(decoding: letters.reversed(), as: UTF8.self)
        }
    }

    /// The `count` likeliest words, completions included, and at least the likeliest word of exactly the typed length.
    func decode(_ taps: [TapEvidence], count: Int = 4) -> [Result] {
        guard !taps.isEmpty else { return [] }
        let best = taps.map(\.best)
        let offset = best.reduce(0, +)
        var heap = Heap<State>()
        var found: [Result] = []
        var seen: Set<Lexicon.Node> = []
        var trail = Trail()
        var exact = 0, pops = 0

        func push(_ state: State) {
            let bound = state.terminal ? state.score : state.score + lexicon.logMass(state.node)
            if bound > -.infinity { heap.push(state, priority: bound) }
        }
        func emit(_ state: State) {
            guard let word = lexicon.logWord(state.node) else { return }
            var terminal = state
            terminal.terminal = true
            terminal.score += word
            push(terminal)
        }
        push(State(node: lexicon.root, tap: 0, edits: 0, completing: false, score: 0, spelling: Trail.empty, terminal: false))

        while found.count < count || exact == 0, pops < Self.budget, let state = heap.pop() {
            pops += 1
            if state.terminal {
                guard seen.insert(state.node).inserted else { continue }
                let word = trail.word(state.spelling)
                let logPrior = lexicon.logWord(state.node) ?? 0
                found.append(Result(word: lexicon.canonical(word) ?? word, logLikelihood: state.score - logPrior + offset, logPrior: logPrior, isCompletion: state.completing))
                if !state.completing { exact += 1 }
                continue
            }
            let i = state.tap
            if i == taps.count, state.spelling != Trail.empty {
                if !state.completing { emit(state) }
            }
            if i < taps.count, state.edits == 0 {
                push(State(node: state.node, tap: i + 1, edits: 1, completing: false,
                           score: state.score + taps[i].stray - best[i] + Self.editLogProbability, spelling: state.spelling, terminal: false))
            }
            for child in lexicon.children(state.node) {
                let letter = lexicon.letter(child)
                guard let index = Lexicon.index(of: letter) else { continue }
                let spelling = trail.extend(state.spelling, with: letter)
                if i == taps.count {
                    let next = State(node: child, tap: i, edits: state.edits, completing: true, score: state.score, spelling: spelling, terminal: false)
                    if lexicon.logWord(child) != nil { emit(next) }
                    push(next)
                    continue
                }
                guard !state.completing else { continue }
                push(State(node: child, tap: i + 1, edits: state.edits, completing: false,
                           score: state.score + taps[i].letters[index] - best[i], spelling: spelling, terminal: false))
                if letter == 39 || state.edits == 0 {
                    push(State(node: child, tap: i, edits: state.edits + (letter == 39 ? 0 : 1), completing: false,
                               score: state.score + (letter == 39 ? Self.apostropheLogProbability : Self.editLogProbability), spelling: spelling, terminal: false))
                }
                if state.edits == 0, i + 1 < taps.count {
                    for grandchild in lexicon.children(child) {
                        guard let second = Lexicon.index(of: lexicon.letter(grandchild)), second != index else { continue }
                        let swapped = taps[i].letters[second] + taps[i + 1].letters[index] - best[i] - best[i + 1]
                        push(State(node: grandchild, tap: i + 2, edits: 1, completing: false,
                                   score: state.score + swapped + Self.editLogProbability, spelling: trail.extend(spelling, with: lexicon.letter(grandchild)), terminal: false))
                    }
                }
            }
        }
        return found
    }

    /// P(taps | word), summed over every reading of the taps as the word: each tap one of its letters, with at most one
    /// missed, extra or swapped tap and any skipped apostrophes, so a doubled letter typed once counts both ways it
    /// could have happened. Within a reading the taps are scored in order, each after the ones before it have taught
    /// the touch model what they meant (the joint predictive): taps that land dead center on their keys say how
    /// steady you are, so a tap far from the key it supposedly meant counts for less. `completing` lets the taps cover
    /// only the start of the word.
    static func logLikelihood(of word: String, given taps: [TapEvidence], touches: TouchModel, on grid: KeyGrid, completing: Bool = false) -> Double {
        let lower = word.lowercased()
        let letters = Array(lower.utf8).compactMap(Lexicon.index(of:))
        guard letters.count == lower.utf8.count else { return -.infinity }
        var total = -Double.infinity
        let start = touches.layout(grid)
        for reading in readings(of: letters, taps: taps.count, completing: completing) {
            var model = start
            var score = reading.logPenalty
            for (tap, letter) in zip(taps, reading.letters) {
                guard let letter else { score += tap.stray; continue }
                let label = Lexicon.labels[letter]
                if let point = tap.point, let likelihood = model.logLikelihood(x: point.x, y: point.y, for: label) {
                    score += likelihood
                    model.suppose(TapSample(tap: point, intended: label))
                } else {
                    score += tap.letters[letter]
                }
            }
            total = Math.logSumExp(total, score)
        }
        return total
    }

    struct Reading {
        var letters: [Int?]
        var logPenalty: Double
    }

    /// Every way `taps` taps can spell `letters` (each tap a letter index, or nil for a stray), as the search allows.
    static func readings(of letters: [Int], taps: Int, completing: Bool) -> [Reading] {
        var found: [Reading] = []
        func walk(_ i: Int, _ j: Int, _ edited: Bool, _ reading: Reading) {
            if j == taps {
                if completing ? (i > 0 && i < letters.count) : i == letters.count { found.append(reading) }
                if completing { return }
            }
            if i < letters.count, j < taps {
                walk(i + 1, j + 1, edited, Reading(letters: reading.letters + [letters[i]], logPenalty: reading.logPenalty))
            }
            if i < letters.count, letters[i] == 26 || !edited {
                walk(i + 1, j, edited || letters[i] != 26, Reading(letters: reading.letters, logPenalty: reading.logPenalty + (letters[i] == 26 ? apostropheLogProbability : editLogProbability)))
            }
            guard !edited else { return }
            if j < taps {
                walk(i, j + 1, true, Reading(letters: reading.letters + [nil], logPenalty: reading.logPenalty + editLogProbability))
            }
            if i + 1 < letters.count, j + 1 < taps, letters[i] != letters[i + 1] {
                walk(i + 2, j + 2, true, Reading(letters: reading.letters + [letters[i + 1], letters[i]], logPenalty: reading.logPenalty + editLogProbability))
            }
        }
        walk(0, 0, false, Reading(letters: [], logPenalty: 0))
        return found
    }
}

struct Heap<Element> {
    private var items: [(priority: Double, element: Element)] = []

    mutating func push(_ element: Element, priority: Double) {
        items.append((priority, element))
        var child = items.count - 1
        while child > 0 {
            let parent = (child - 1) / 2
            guard items[parent].priority < items[child].priority else { break }
            items.swapAt(parent, child)
            child = parent
        }
    }

    mutating func pop() -> Element? {
        guard !items.isEmpty else { return nil }
        items.swapAt(0, items.count - 1)
        let top = items.removeLast()
        var parent = 0
        while true {
            let left = parent * 2 + 1, right = left + 1
            var largest = parent
            if left < items.count, items[left].priority > items[largest].priority { largest = left }
            if right < items.count, items[right].priority > items[largest].priority { largest = right }
            guard largest != parent else { break }
            items.swapAt(parent, largest)
            parent = largest
        }
        return top.element
    }
}
