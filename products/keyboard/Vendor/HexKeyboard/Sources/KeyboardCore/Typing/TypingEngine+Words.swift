struct Revert: Hashable {
    var original: String
    var replacement: String
    var trailing: String?
    var offered = false

    func isCommitted(before text: String?) -> Bool {
        guard let trailing, !offered else { return false }
        return text?.hasSuffix(replacement + trailing) == true
    }

    func isOffered(before text: String) -> Bool {
        offered && text.hasSuffix(replacement)
    }
}

/// A space tap that may have been a letter: the "." shortcut's second space, or a space typed where no word ended.
struct StraySpace: Hashable {
    var tap: Tap
    var swallowed: String
    var restored: String
    var counted: Bool
}

/// The taps of the word being typed, the taps backspace erased (by position), and erased taps labeled by the letter
/// retyped over them.
struct WordTaps: Hashable {
    var letters: [Tap] = []
    var erased: [Int: Tap] = [:]
    var retyped: [TapSample] = []

    mutating func add(_ tap: Tap, for letter: String, on grid: KeyGrid?) {
        if let erased = erased.removeValue(forKey: letters.count), let grid, grid.reaches(letter, x: erased.x, y: erased.y) {
            retyped.append(TapSample(tap: erased, intended: letter))
        }
        letters.append(tap)
    }

    mutating func eraseLast() -> Bool {
        guard let tap = letters.popLast() else { return false }
        erased[letters.count] = tap
        return true
    }
}

/// A committed word whose taps become labels once you move on without changing it.
struct PendingWord: Hashable {
    var word: String
    var typed: String
    var taps: [Tap]
    var retyped: [TapSample]
    var ending: Tap?

    var samples: [TapSample] {
        let letters = word.lowercased().map(String.init)
        let spelled = letters.count == taps.count ? zip(taps, letters).map { TapSample(tap: $0, intended: $1) } : []
        return spelled + retyped + (ending.map { [TapSample(tap: $0, intended: " ")] } ?? [])
    }
}

extension TypingEngine {
    var correcting: Bool { settings.autoCorrection && traits.allowsCorrection }

    public var showsSuggestions: Bool {
        switch traits.kind {
        case .email, .url, .number, .decimal: false
        default: settings.predictiveText
        }
    }

    /// The key a touch means: from the key map made for the text as it is now, or, until that's ready, the key under it.
    public func key(atX x: Double, y: Double, in grid: KeyGrid) -> (row: Int, key: Int)? {
        guard let keyMap, keyMap.revision == revision else { return grid.index(atX: x, y: y) }
        return keyMap.key(atX: x, y: y, in: grid)
    }

    /// The keys as they're laid out now. Taps are learned per layout, so a new layout ends the session first.
    public mutating func use(_ grid: KeyGrid) {
        guard let corrector, layer == .letters else { return }
        if grid.signature != corrector.grid.signature { endSession() }
        corrector.grid = grid
    }

    public func layout(on device: DeviceClass, showsGlobe: Bool = false, isLandscape: Bool = false) -> LayoutContext {
        LayoutContext(device: device, layer: layer, kind: traits.kind, showsGlobe: showsGlobe, isLandscape: isLandscape, oneHanded: settings.oneHanded)
    }

    public func faces(on device: DeviceClass) -> KeyFaceContext {
        let returnEnabled = !traits.returnRequiresText || !text.before.isEmpty || !(text.after ?? "").isEmpty
        return KeyFaceContext(device: device, layer: layer, kind: traits.kind, shift: shift, returnKind: traits.returnKind, returnEnabled: returnEnabled)
    }

    /// Learns from the last word you kept. Call when typing pauses for good, like when the keyboard goes away.
    public mutating func endSession() {
        learnPending()
        typing = WordTaps()
    }

    public mutating func accept(_ suggestion: Suggestion, in document: some TextDocument) {
        attach(document)
        if suggestion.kind == .swipe { _ = acceptSwipe(suggestion.text, in: document); return }
        let text = self.text.before
        let word = Words.current(in: text)
        guard text[..<word.startIndex] == suggestionsBefore else { return }
        let previous = Words.previous(before: word, in: text)
        switch suggestion.kind {
        case .swipe: return
        case .revert:
            guard let revert, revert.isOffered(before: text), self.text.owned >= revert.replacement.count else { return }
            write(revert.original, replacing: revert.replacement.count, in: document)
            corrector?.memory.keep(revert.original)
            pending?.word = revert.original
        case .literal:
            corrector?.memory.keep(suggestion.text)
            hold(suggestion.text, typed: String(word))
        case .correction, .candidate:
            write(suggestion.text, replacing: word.count, in: document)
            hold(suggestion.text, typed: String(word))
        }
        if !suggestion.text.contains(" ") { corrector?.memory.record(suggestion.text, after: previous) }
        revert = nil
        typing = WordTaps()
        write(" ", in: document)
        refreshShift()
        suggestionsChanged()
    }

    /// Marks the suggestions out of date: ranks them now, or leaves them for a `SuggestionJob`.
    public mutating func suggestionsChanged() {
        revision += 1
        if defersSuggestions { suggestionsAreStale = true } else { refreshSuggestions() }
    }

    /// The ranking behind stale suggestions, packed to run on another thread. Only a lexicon ranks off the main thread.
    public func suggestionJob() -> SuggestionJob? {
        guard suggestionsAreStale, let corrector, corrector.lexicon != nil else { return nil }
        var copy = self
        copy.corrector = corrector.snapshot()
        return SuggestionJob(engine: copy)
    }

    /// Shows a finished job's suggestions and keeps its rankings (so the space's autocorrect finds them ready), unless
    /// the text changed after the job was packed.
    public mutating func finish(_ job: SuggestionJob) {
        guard job.engine.revision == revision, let snapshot = job.engine.corrector else { return }
        suggestions = job.engine.suggestions
        suggestionsBefore = job.engine.suggestionsBefore
        keyMap = job.engine.keyMap
        suggestionsAreStale = false
        corrector?.adopt(snapshot)
    }

    mutating func commitWord(in document: some TextDocument, ending: Tap? = nil) {
        let stray = self.stray
        defer {
            typing = WordTaps()
            self.stray = nil
        }
        guard let corrector else { return }
        let text = self.text.before
        let word = Words.current(in: text)
        guard !word.isEmpty else { return }
        var final = String(word), typedText = final
        var previous = Words.previous(before: word, in: text)
        let midWord = self.text.after?.first.map(Words.isWordCharacter) ?? false
        let owned = self.text.owned
        guard correcting, !midWord, owned >= word.count, Words.isCorrectable(word, in: text) else {
            return settle(final, typed: final, after: previous, ending: ending)
        }
        let typed = TypedWord(final, taps: typing.letters, previous: previous)
        if let stray, owned >= word.count + stray.swallowed.count, text.dropLast(word.count).hasSuffix(stray.swallowed),
           case let before = Words.current(in: String(text.dropLast(word.count + stray.swallowed.count))).lowercased(),
           let joined = corrector.joined(nil, space: stray.tap, TypedWord(final.lowercased(), taps: typing.letters, previous: before)) {
            write(stray.restored + joined, replacing: word.count + stray.swallowed.count, in: document)
            revert = Revert(original: stray.swallowed + final, replacement: stray.restored + joined)
            if stray.counted { corrector.memory.unrecordSpaceAfterSpace(keepingKey: true) }
            typing.letters = [stray.tap] + typing.letters
            final = joined
            typedText = joined
            previous = before
        } else if let pending, owned >= pending.word.count + 1 + word.count, let join = join(typed, after: pending, in: text) {
            write(join.word, replacing: pending.word.count + 1 + word.count, in: document)
            revert = Revert(original: "\(pending.word) \(final)", replacement: join.word)
            corrector.memory.forget(pending.word, after: join.previous)
            typing.letters = pending.taps + [join.space] + typing.letters
            self.pending = nil
            final = join.word
            typedText = join.word
            previous = join.previous
        } else if let correction = corrector.correction(for: typed, guessing: traits.spellChecking) {
            write(correction, replacing: word.count, in: document)
            revert = Revert(original: final, replacement: correction)
            final = correction
        }
        settle(final, typed: typedText, after: previous, ending: ending)
    }

    private mutating func settle(_ word: String, typed: String, after previous: String?, ending: Tap?) {
        if !word.contains(" ") { corrector?.memory.record(word, after: previous) }
        hold(word, typed: typed, ending: ending)
    }

    /// Ranks what a space would check now, whether this word and the last were one ("a out" → "about"), so the
    /// rankings are cached by the time the space comes.
    func rankJoin() {
        guard correcting, let pending else { return }
        let text = self.text.before
        let word = Words.current(in: text)
        guard !word.isEmpty, Words.isCorrectable(word, in: text) else { return }
        _ = join(TypedWord(String(word), taps: typing.letters, previous: Words.previous(before: word, in: text)), after: pending, in: text)
    }

    /// Whether the space between the last word and this one was really a letter you missed ("a out" → "about").
    private func join(_ typed: TypedWord, after pending: PendingWord, in text: String) -> (word: String, space: Tap, previous: String?)? {
        guard let corrector, let space = pending.ending, pending.taps.count == pending.typed.count else { return nil }
        let head = String(text.dropLast(typed.text.count))
        guard head.hasSuffix(pending.word + " ") else { return nil }
        let firstText = Words.current(in: String(head.dropLast()))
        guard firstText == pending.word[...] else { return nil }
        let before = Words.previous(before: firstText, in: String(head.dropLast()))
        let first = TypedWord(pending.typed, taps: pending.taps, previous: before)
        guard let joined = corrector.joined(first, space: space, TypedWord(typed.text, taps: typed.taps, previous: pending.word.lowercased())) else { return nil }
        return (Words.matchCase(joined, to: Substring(pending.typed)), space, before)
    }

    /// A second space right after a word: whether the first one was really the word's last letter ("jo" → "job").
    mutating func joinBack(space: Tap, in document: some TextDocument) -> Bool {
        guard correcting, let corrector, let pending, let end = pending.ending, pending.taps.count == pending.typed.count,
              self.text.owned >= pending.word.count + 1 else { return false }
        let text = self.text.before
        let head = String(text.dropLast())
        guard text.hasSuffix(pending.word + " "), Words.current(in: head) == pending.word[...] else { return false }
        let previous = Words.previous(before: Words.current(in: head), in: head)
        guard let joined = corrector.joined(TypedWord(pending.typed, taps: pending.taps, previous: previous), space: end, nil) else { return false }
        let word = Words.matchCase(joined, to: Substring(pending.typed))
        write(word + " ", replacing: pending.word.count + 1, in: document)
        revert = Revert(original: pending.word + ".", replacement: word, trailing: " ")
        corrector.memory.forget(pending.word, after: previous)
        corrector.memory.record(word, after: previous)
        corrector.memory.unrecordSpaceAfterSpace(keepingKey: false)
        self.pending = PendingWord(word: word, typed: word, taps: pending.taps + [end], retyped: pending.retyped, ending: space)
        return true
    }

    private mutating func hold(_ word: String, typed: String, ending: Tap? = nil) {
        learnPending()
        pending = PendingWord(word: word, typed: typed, taps: typing.letters, retyped: typing.retyped, ending: ending)
    }

    mutating func learnPending() {
        if let pending { corrector?.learn(pending.samples) }
        pending = nil
    }

    mutating func recordTap(_ tap: Tap, for letter: String) {
        if let pending, text.before.hasSuffix(pending.word) { self.pending = nil }
        typing.add(tap, for: letter, on: corrector?.grid)
    }

    mutating func eraseTap() {
        guard !typing.eraseLast() else { return }
        if let pending, pending.taps.count == pending.word.count, Words.current(in: text.before) == pending.word[...] {
            typing.letters = pending.taps
            typing.retyped = pending.retyped
            if let ending = pending.ending { typing.erased[typing.letters.count] = ending }
            self.pending = nil
        }
    }

    mutating func refreshSuggestions() {
        suggestionsAreStale = false
        if let swipe = activeSwipe {
            suggestions = swipe.candidates.map { Suggestion($0, .swipe) }
            keyMap = nil
            return
        }
        let text = self.text.before
        let word = Words.current(in: text)
        let inWords = layer == .letters && correcting && (word.isEmpty || Words.isCorrectable(word, in: text))
        keyMap = corrector?.keyMap(revision: revision, after: inWords ? String(word) : nil)
        guard let corrector, showsSuggestions else { return suggestions = [] }
        suggestionsBefore = String(text[..<word.startIndex])
        let typed = TypedWord(String(word), taps: typing.letters, previous: Words.previous(before: word, in: text))
        if let revert, revert.isOffered(before: text) {
            let completions = corrector.suggestions(for: typed, correcting: false, guessing: false).dropFirst()
            suggestions = [Suggestion(revert.original, .revert)] + completions
        } else if word.isEmpty {
            let context = Words.context(before: word, in: text)
            suggestions = corrector.predictions(after: context.previous, earlier: context.earlier, context: text).map { prediction in
                var prediction = prediction
                switch shift {
                case .off: break
                case .on: prediction.text = prediction.text.prefix(1).uppercased() + prediction.text.dropFirst()
                case .locked: prediction.text = prediction.text.uppercased()
                }
                return prediction
            }
        } else {
            let correcting = correcting && Words.isCorrectable(word, in: text)
            suggestions = corrector.suggestions(for: typed, correcting: correcting, guessing: traits.spellChecking)
        }
    }
}

/// A copy of the engine with a corrector of its own: nothing else references it, so it may rank on any thread.
public struct SuggestionJob: @unchecked Sendable {
    fileprivate var engine: TypingEngine

    public mutating func run() {
        engine.refreshSuggestions()
        engine.rankJoin()
    }
}
