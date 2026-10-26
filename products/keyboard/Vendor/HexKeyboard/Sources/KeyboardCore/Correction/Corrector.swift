public final class Corrector {
    public var usualEnhancements = true
    public let source: any CandidateSource
    public let phrases: Phrases?
    public var replacements: [String: String] = [:]
    public var names: [String: String] = [:]
    public var memory = TypingMemory() {
        didSet {
            cachedModel = nil
            rankings = [:]
            generation += 1
        }
    }
    public var grid = KeyGrid.standard {
        didSet {
            rankings = [:]
            generation += 1
        }
    }

    let lexicon: Lexicon?
    private var cachedModel: LanguageModel?
    private var rankings: [Ranking: [Candidate]] = [:]
    private var generation = 0

    private struct Ranking: Hashable {
        var typed: TypedWord
        var alone: Bool
    }

    /// With a `Lexicon` as its source, the corrector decodes your taps against your own touch model and words;
    /// any other source (like `UITextChecker`) only corrects spelling. `Phrases` tell it what words follow which.
    public init(source: any CandidateSource, phrases: Phrases? = nil) {
        self.source = source
        self.phrases = phrases
        self.lexicon = source as? Lexicon
    }

    /// A corrector with the same words, touches and grid, and caches of its own.
    func snapshot() -> Corrector {
        let copy = Corrector(source: source, phrases: phrases)
        copy.usualEnhancements = usualEnhancements
        copy.replacements = replacements
        copy.names = names
        copy.memory = memory
        copy.grid = grid
        copy.cachedModel = cachedModel
        copy.rankings = rankings
        copy.generation = generation
        return copy
    }

    /// Keeps what a snapshot ranked, if this corrector's words, touches and grid haven't changed since.
    func adopt(_ snapshot: Corrector) {
        guard snapshot.generation == generation else { return }
        rankings.merge(snapshot.rankings) { mine, _ in mine }
        if cachedModel == nil { cachedModel = snapshot.cachedModel }
    }

    public func setReplacements(_ pairs: [(shortcut: String, phrase: String)]) {
        replacements = Dictionary(pairs.map { ($0.shortcut.lowercased(), $0.phrase) }) { first, _ in first }
    }

    /// Contact names from `UILexicon` include everyday words ("A", "My", "The"). Typed lowercase, those mean the word,
    /// so a name the lexicon spells lowercase is left out.
    public func setNames(_ words: [String]) {
        let names = words.filter { lexicon?.canonical($0) != $0.lowercased() }
        self.names = Dictionary(names.map { ($0.lowercased(), $0) }) { first, _ in first }
    }

    public func learn(_ samples: [TapSample]) {
        memory.touches.learn(samples, on: grid)
    }

    public func correction(for word: TypedWord, guessing: Bool = true) -> String? {
        let text = Substring(word.text)
        let lower = word.text.lowercased()
        if let phrase = replacements[lower] { return phrase == word.text ? nil : phrase }
        if memory.isKept(lower) { return nil }
        if let name = names[lower] {
            return word.text == name || word.text == word.text.uppercased() ? nil : name
        }
        guard guessing else { return nil }
        if usualEnhancements, let short = shortSlip(word) { return short }
        if usualEnhancements, let split = splitJoined(word) { return split }
        if let lexicon {
            let ranked = ranked(word)
            guard let best = ranked.first(where: { !$0.isCompletion }), best.word != word.text else { return nil }
            if best.isLiteral { return lexicon.canonical(lower) == best.word && best.word != lower ? best.word : nil }
            if isKnown(word), let literal = ranked.first(where: \.isLiteral), literal.logLikelihood >= best.logLikelihood { return nil }
            return Words.matchCase(best.word, to: text)
        }
        guard !source.isWord(word.text), let guess = source.guesses(for: word).first else { return nil }
        return Words.matchCase(guess, to: text)
    }

    func suggestions(for word: TypedWord, correcting: Bool, guessing: Bool) -> [Suggestion] {
        let typed = Substring(word.text)
        var seen: Set<String> = [word.text.lowercased()]
        var alternatives: [Suggestion] = []
        func add(_ candidates: some Sequence<String>, as kind: Suggestion.Kind) {
            for candidate in candidates where alternatives.count < 2 {
                let text = kind == .correction ? candidate : Words.matchCase(candidate, to: typed)
                if seen.insert(text.lowercased()).inserted { alternatives.append(Suggestion(text, kind)) }
            }
        }
        if correcting, let correction = correction(for: word, guessing: guessing) { add([correction], as: .correction) }
        let lower = word.text.lowercased()
        add(names.filter { $0.key.count > lower.count && $0.key.hasPrefix(lower) }.values.sorted(), as: .candidate)
        if lexicon != nil {
            add(ranked(word).filter { !$0.isLiteral }.map(\.word), as: .candidate)
        } else {
            add(memory.completions(for: word.text), as: .candidate)
            add(source.completions(for: word.text), as: .candidate)
            if guessing, alternatives.count < 2 { add(source.guesses(for: word), as: .candidate) }
        }
        return [Suggestion(word.text, .literal)] + alternatives
    }

    func predictions(after previous: String?, earlier: String?, context: String) -> [Suggestion] {
        var seen: Set<String> = []
        var words = (previous.map(memory.predictions(after:)) ?? []) + source.predictions(after: context)
        if let lexicon {
            let model = languageModel(lexicon)
            let phrased = phrases?.next(after: previous, earlier: earlier).map { lexicon.canonical($0) ?? $0 } ?? []
            words = (words + phrased + lexicon.mostFrequent(count: 6))
                .map { ($0, model.logPrediction($0, after: previous, earlier: earlier)) }
                .sorted { $0.1 > $1.1 }
                .map(\.0)
        }
        return words
            .filter { seen.insert($0.lowercased()).inserted }
            .prefix(3)
            .map { Suggestion($0, .candidate) }
    }

    /// The words Check Spelling underlines: words with no digits that aren't in the lexicon (nor its possessive),
    /// a name, a text replacement or a word you've kept.
    public func misspellings(in text: String) -> [Range<String.Index>] {
        text.split { !Words.isWordCharacter($0) }
            .map { $0.drop(while: Words.apostrophes.contains).dropLast(while: Words.apostrophes.contains) }
            .filter { !$0.isEmpty && !$0.contains(where: \.isNumber) && !isSpelled(String($0.map { $0 == "’" ? "'" : $0 })) }
            .map { $0.startIndex..<$0.endIndex }
    }

    private func isSpelled(_ word: String) -> Bool {
        let lower = word.lowercased()
        if source.isWord(word) || memory.isKept(lower) || names[lower] != nil || replacements[lower] != nil { return true }
        return lower.hasSuffix("'s") && source.isWord(String(word.dropLast(2)))
    }
}

extension Corrector {
    struct Candidate {
        var word: String
        var logLikelihood: Double
        var logPosterior: Double
        var isCompletion: Bool
        var isLiteral: Bool
    }

    /// Candidates for what you meant, likeliest first. `alone` leaves out the words you've typed, so only the lexicon
    /// and your touches speak.
    func ranked(_ typed: TypedWord, alone: Bool = false) -> [Candidate] {
        let key = Ranking(typed: typed, alone: alone)
        if let cached = rankings[key] { return cached }
        let candidates = rank(typed, alone: alone)
        rankings[key] = candidates
        return candidates
    }

    private func rank(_ typed: TypedWord, alone: Bool) -> [Candidate] {
        guard let lexicon, !typed.text.isEmpty else { return [] }
        let words = alone ? TypingMemory() : memory
        let model = alone ? LanguageModel(lexicon: lexicon, memory: words) : languageModel(lexicon)
        let taps = evidence(for: typed, touches: memory.touches)
        let literal = typed.text.lowercased()
        var candidates: [String: Candidate] = [:]
        func consider(_ word: String, logLikelihood: Double, isCompletion: Bool) {
            let lower = word.lowercased()
            let isLiteral = lower == literal
            let score = logLikelihood + model.logProbability(word, after: typed.previous)
            guard score > -.infinity, score > candidates[lower]?.logPosterior ?? -.infinity else { return }
            candidates[lower] = Candidate(word: word, logLikelihood: logLikelihood, logPosterior: score, isCompletion: isCompletion && !isLiteral, isLiteral: isLiteral)
        }
        func likelihood(_ word: String, completing: Bool = false) -> Double {
            Decoder.logLikelihood(of: word, given: taps, touches: memory.touches, on: grid, completing: completing)
        }
        for result in Decoder(lexicon: lexicon).decode(taps, count: usualEnhancements ? 12 : 4) {
            consider(result.word, logLikelihood: likelihood(result.word, completing: result.isCompletion), isCompletion: result.isCompletion)
        }
        let literalWord = lexicon.canonical(literal) ?? typed.text
        consider(literalWord, logLikelihood: likelihood(literalWord), isCompletion: false)
        for word in words.familiar where word.utf8.count + 1 >= taps.count && lexicon.logProbability(of: word) == nil {
            let exact = likelihood(word)
            let completed = likelihood(word, completing: true)
            consider(word, logLikelihood: max(exact, completed), isCompletion: completed > exact)
        }
        return candidates.values.sorted { $0.logPosterior > $1.logPosterior }
    }

    /// A word that stands on its own, which autocorrect replaces only when your touches fit the other word better: one
    /// you've kept, or a real word that, typed dead center on its keys, still reads as itself. Reading it with an
    /// apostrophe added ("its" → "it's") doesn't count against it.
    func isKnown(_ word: TypedWord) -> Bool {
        if memory.isKept(word.text) { return true }
        guard lexicon?.isWord(word.text) == true || memory.count(of: word.text) > 1 else { return false }
        guard let perfect = ranked(TypedWord(word.text), alone: true).first(where: { !$0.isCompletion }), !perfect.isLiteral else { return true }
        return perfect.word.contains("'")
    }

    func evidence(for typed: TypedWord, touches: TouchModel) -> [TapEvidence] {
        let letters = typed.text.lowercased().utf8.map(Lexicon.fold)
        let taps = typed.taps.count == letters.count ? typed.taps.map(Optional.some) : letters.map { _ in nil }
        let bounds = grid.bounds
        let stray = -Math.log(bounds.width * bounds.height)
        let keys = touches.layout(grid)
        return zip(letters, taps).map { letter, tap in
            guard let index = Lexicon.index(of: letter), let typed = grid.frame(of: Lexicon.labels[index]) else { return .exact(letter) }
            let point = tap.map { ($0.x, $0.y) } ?? (typed.midX, typed.midY)
            let likelihoods = Lexicon.labels.map { keys.logLikelihood(x: point.0, y: point.1, for: $0) ?? -.infinity }
            return TapEvidence(letters: likelihoods, stray: stray, point: Tap(x: point.0, y: point.1, key: Lexicon.labels[index]))
        }
    }

    func languageModel(_ lexicon: Lexicon) -> LanguageModel {
        if let cachedModel { return cachedModel }
        let model = LanguageModel(lexicon: lexicon, memory: memory, phrases: phrases)
        cachedModel = model
        return model
    }
}

extension Corrector {
    /// The word a space tap spelled if it meant a letter: between two words ("a out" → "about"), or with one side
    /// missing when it was a stray space before a word ("ut" → "but") or after one ("jo" → "job").
    func joined(_ first: TypedWord?, space: Tap, _ second: TypedWord?) -> String? {
        let parts = [first, second].compactMap { $0 }
        guard let lexicon, !parts.isEmpty, parts.allSatisfy({ !$0.text.isEmpty && $0.taps.count == $0.text.count }),
              case let keys = memory.touches.layout(grid),
              let asSpace = keys.logLikelihood(x: space.x, y: space.y, for: " "),
              let letter = Lexicon.labels.dropLast().max(by: {
                  keys.logLikelihood(x: space.x, y: space.y, for: $0) ?? -.infinity < keys.logLikelihood(x: space.x, y: space.y, for: $1) ?? -.infinity
              }) else { return nil }
        let together = TypedWord((first?.text ?? "") + letter + (second?.text ?? ""), taps: (first?.taps ?? []) + [space] + (second?.taps ?? []),
                                 previous: first?.previous ?? second?.previous)
        guard let word = ranked(together).first(where: { !$0.isCompletion && (lexicon.isWord($0.word) || memory.count(of: $0.word) > 1) }) else { return nil }
        var apart = 0.0, apartLikelihood = asSpace
        for (index, part) in parts.enumerated() {
            let previous = index == 0 && first == nil ? "" : part.previous
            guard let best = ranked(TypedWord(part.text, taps: part.taps, previous: previous)).first(where: { !$0.isCompletion }) else { return nil }
            apart += best.logPosterior
            apartLikelihood += best.logLikelihood
        }
        apart += asSpace
        if parts.count == 1 {
            let secondSpace = languageModel(lexicon).next(after: "")[" "] ?? 0.5
            apart += Math.log(secondSpace)
            if word.logPosterior + Math.log(1 - secondSpace) <= apart { return nil }
        } else if word.logPosterior <= apart {
            return nil
        }
        if parts.allSatisfy(isKnown), word.logLikelihood <= apartLikelihood { return nil }
        return word.word
    }
}
