struct SwipeCommit {
    var before: String
    var after: String?
    var leading: String
    var trailing: String
    var word: String
    var candidates: [String]
    var inserted: String { leading + word + trailing }
}

extension TypingEngine {
    public var canInsertSwipe: Bool {
        guard text.isKnown, layer == .letters, traits.allowsCorrection,
              !(text.after?.first.map(Words.isWordCharacter) ?? false) else { return false }
        guard let last = text.before.last, !last.isWhitespace else { return true }
        if Self.wordEnders.contains(String(last)), text.owned > 0 { return true }
        let current = String(Words.current(in: text.before))
        // Separate a completed word typed by this keyboard; don't guess at an existing/unfinished prefix.
        return !current.isEmpty && text.owned >= current.count &&
            (corrector?.source.isWord(current.lowercased()) == true || corrector?.memory.isKept(current) == true ||
             (corrector?.memory.count(of: current.lowercased()) ?? 0) >= 2)
    }

    public var swipeVocabulary: [String] {
        guard let memory = corrector?.memory else { return [] }
        return Set(memory.counts.filter { $0.value > 1 }.keys.map { $0.lowercased() })
            .union(memory.kept.map { $0.lowercased() }).sorted()
    }

    var activeSwipe: SwipeCommit? {
        guard let swipeCommit, text.before == swipeCommit.before + swipeCommit.inserted,
              text.after == swipeCommit.after, text.owned >= swipeCommit.inserted.count else { return nil }
        return swipeCommit
    }

    @discardableResult
    public mutating func insertSwipe(_ candidates: [String], in document: some TextDocument) -> Bool {
        attach(document)
        guard canInsertSwipe else { return false }
        let eligible = Array(candidates.filter { LocalSwipeDecoder.eligible($0) }.prefix(3))
        guard !eligible.isEmpty else { return false }
        let leading = text.before.last.map { $0.isWhitespace ? "" : " " } ?? ""
        let capitalize = shift == .on || (settings.autoCapitalization &&
            Self.shouldCapitalize(text.before + leading, mode: traits.autocapitalization))
        let shown = eligible.map { word in
            if shift == .locked { return word.uppercased() }
            if capitalize { return word.prefix(1).uppercased() + word.dropFirst() }
            return corrector?.names[word] ?? corrector?.lexicon?.canonical(word) ?? word
        }
        let commit = SwipeCommit(before: text.before, after: text.after,
            leading: leading,
            trailing: (text.after ?? "").isEmpty ? " " : "", word: shown[0], candidates: shown)
        learnPending()
        forgetWord()
        write(commit.inserted, in: document)
        swipeCommit = commit
        refreshShift()
        showSwipeAlternatives()
        return true
    }

    mutating func showSwipeAlternatives() {
        guard let swipe = activeSwipe else { return }
        revision += 1
        keyMap = nil
        suggestionsAreStale = false
        suggestions = swipe.candidates.map { Suggestion($0, .swipe) }
    }

    mutating func acceptSwipe(_ candidate: String, in document: some TextDocument) -> Bool {
        guard var swipe = activeSwipe, swipe.candidates.contains(candidate) else { return false }
        let oldCount = swipe.inserted.count
        swipe.word = candidate
        write(swipe.inserted, replacing: oldCount, in: document)
        swipeCommit = swipe
        refreshShift()
        showSwipeAlternatives()
        return true
    }

    /// Returns true when the action was completely handled. Layer/shift controls retain alternatives.
    mutating func prepareAfterSwipe(_ action: KeyAction, in document: some TextDocument) -> Bool {
        guard let swipe = activeSwipe else { swipeCommit = nil; return false }
        switch action {
        case .delete:
            write("", replacing: swipe.inserted.count, in: document)
            forgetWord()
            refreshShift()
            suggestionsChanged()
            return true
        case .space where swipe.trailing == " ":
            swipeCommit = nil
            spaceJustTyped = true
            suggestionsChanged()
            return true
        case .character(let value):
            if swipe.trailing == " ", Self.wordEnders.contains(value) {
                write("", replacing: 1, in: document)
            }
            swipeCommit = nil
        case .return:
            if swipe.trailing == " " { write("", replacing: 1, in: document) }
            swipeCommit = nil
        case .space, .tab:
            swipeCommit = nil
        default: break
        }
        return false
    }
}
