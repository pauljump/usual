public struct TypingEngine {
    public private(set) var layer: KeyboardLayer = .letters
    public private(set) var shift: ShiftState = .off
    public private(set) var traits: InputTraits
    public internal(set) var suggestions: [Suggestion] = []
    /// Leaves `suggestions` stale after each change, for a `SuggestionJob` to rank off the keystroke's path.
    public var defersSuggestions = false
    public internal(set) var suggestionsAreStale = false
    /// Which key a touch means, made with the suggestions (off the main thread when they're deferred).
    public internal(set) var keyMap: KeyMap?
    /// The text before the word the suggestions were ranked for: a tap on one replaces only that word.
    var suggestionsBefore = ""
    var revision = 0
    public var settings = KeyboardSettings() {
        didSet { if settings != oldValue { suggestionsChanged() } }
    }
    public var corrector: Corrector?
    /// The one copy of the text the engine reads. The keyboard's edits reach it through `write` and `moveCursor`, the
    /// host's reports through `documentChanged`.
    public private(set) var text = TextState()

    /// Explicit host action: replace the known draft, keeping our full context even when iOS reports a suffix.
    public mutating func replaceKnownDraft(with value: String, in document: some TextDocument) {
        let after = text.after ?? ""
        moveCursor(by: after.count, in: document)
        write(value, replacing: text.before.count, in: document)
        forgetWord()
        refreshShift()
        suggestionsChanged()
    }

    var spaceJustTyped = false
    var swipeCommit: SwipeCommit?
    private var shiftHold: ShiftHold?
    var typing = WordTaps()
    var pending: PendingWord?
    var stray: StraySpace?
    var revert: Revert?

    private enum ShiftHold { case pressed, typedWhileHeld }

    public init(traits: InputTraits = InputTraits()) {
        self.traits = traits
        self.layer = Self.initialLayer(for: traits.kind)
    }

    public mutating func update(_ traits: InputTraits) {
        guard traits != self.traits else { return }
        if traits.kind != self.traits.kind { layer = Self.initialLayer(for: traits.kind) }
        self.traits = traits
        suggestionsChanged()
    }

    public mutating func perform(_ action: KeyAction, in document: some TextDocument, tap: Tap? = nil) {
        attach(document)
        if prepareAfterSwipe(action, in: document) { return }
        switch action {
        case .shift:
            shift = shift == .off ? .on : .off
            return
        case .capsLock:
            shift = shift == .locked ? .off : .locked
            return
        case .layer(let target):
            layer = target
            suggestionsChanged()
            return
        case .nextKeyboard, .dismiss:
            return
        case .character, .space, .return, .tab, .delete:
            break
        }

        let wasSpace = spaceJustTyped
        let revert = self.revert
        spaceJustTyped = false
        self.revert = nil
        if wasSpace, action != .delete { corrector?.memory.recordAfterSpace(isSpace: action == .space) }

        switch action {
        case .character(let key):
            var typed = shift.isUppercase && layer == .letters ? key.uppercased() : key
            if settings.smartPunctuation, traits.smartPunctuation {
                if typed == "-", text.before.last == "-", text.owned >= 1 {
                    write("", replacing: 1, in: document)
                    typed = "—"
                } else {
                    typed = Self.smartQuote(typed, after: text.before)
                }
            }
            if Self.wordEnders.contains(typed) {
                commitWord(in: document)
            } else if let tap, typed.allSatisfy(Words.isWordCharacter) {
                recordTap(tap, for: typed.lowercased())
            }
            write(typed, in: document)
            self.revert?.trailing = typed
            if layer != .letters, Self.returnsToLetters.contains(key) { layer = .letters }
            if shiftHold != nil { shiftHold = .typedWhileHeld }
        case .space:
            if wasSpace, let tap, joinBack(space: tap, in: document) {
                spaceJustTyped = true
            } else if wasSpace, settings.periodShortcut, traits.smartPunctuation, text.owned >= 1, Self.endsSentenceable(text.before) {
                write(". ", replacing: 1, in: document)
                stray = tap.map { StraySpace(tap: $0, swallowed: ". ", restored: " ", counted: true) }
            } else {
                let blank = text.before.last.map(\.isWhitespace) ?? true
                commitWord(in: document, ending: tap)
                write(" ", in: document)
                self.revert?.trailing = " "
                spaceJustTyped = true
                if blank, let tap { stray = StraySpace(tap: tap, swallowed: " ", restored: "", counted: wasSpace) }
            }
            if layer != .letters { layer = .letters }
        case .return:
            commitWord(in: document)
            write("\n", in: document)
            self.revert?.trailing = "\n"
        case .tab:
            write("\t", in: document)
        case .delete:
            stray = nil
            let offersRevert = revert?.isCommitted(before: text.before) == true
            write("", replacing: 1, in: document)
            if offersRevert {
                self.revert = revert
                self.revert?.offered = true
            } else {
                eraseTap()
            }
        default:
            break
        }
        refreshShift()
        suggestionsChanged()
    }

    /// Returns false for events the engine ignores, like a letter's touch down: those change nothing to redraw.
    @discardableResult
    public mutating func handle(_ event: KeyboardEvent, in document: some TextDocument) -> Bool {
        switch event {
        case .down(let key, let tapCount):
            switch key.action {
            case .shift: pressShift(doubleTap: tapCount == 2)
            case .capsLock, .delete, .layer: perform(key.action, in: document)
            default: return false
            }
        case .up(let key):
            guard key.action == .shift else { return false }
            releaseShift(in: document)
        case .type(let key, let tap):
            perform(key.action == .space ? .space : .character(tap.key), in: document, tap: tap)
        case .slide(let text):
            let layer = self.layer
            perform(.character(text), in: document)
            if self.layer == layer { perform(.layer(.letters), in: document) }
        case .trigger(let key):
            guard key.action == .return || key.action == .tab else { return false }
            perform(key.action, in: document)
        case .cursor(let offset):
            moveCursor(by: offset, in: document)
        case .oneHanded(let hand):
            settings.oneHanded = hand
        case .pickHand(let hand):
            settings.oneHanded = hand
            perform(.layer(.letters), in: document)
        }
        return true
    }

    public mutating func deleteWord(in document: some TextDocument) {
        attach(document)
        swipeCommit = nil
        spaceJustTyped = false
        revert = nil
        if typing.letters.isEmpty { pending = nil }
        typing = WordTaps()
        write("", replacing: Self.wordLength(before: text.before), in: document)
        refreshShift()
        suggestionsChanged()
    }

    /// Moves the caret, as the space bar trackpad does.
    mutating func moveCursor(by offset: Int, in document: some TextDocument) {
        attach(document)
        document.moveCursor(by: offset)
        text.moveCursor(by: offset)
        forgetWord()
        refreshShift()
        suggestionsChanged()
    }

    mutating func pressShift(doubleTap: Bool) {
        shift = doubleTap && settings.capsLock ? .locked : shift == .off ? .on : .off
        shiftHold = .pressed
    }

    mutating func releaseShift(in document: some TextDocument) {
        let typed = shiftHold == .typedWhileHeld
        shiftHold = nil
        guard typed, shift == .on else { return }
        attach(document)
        refreshShift()
    }

    /// The host's `textDidChange` or `selectionDidChange`. A report showing the keyboard's own edits, even late, changes
    /// nothing; anything else replaces what the engine knows and forgets the word in progress.
    @discardableResult
    public mutating func documentChanged(_ document: some TextDocument) -> TextState.Report {
        let report = text.reconcile(before: document.textBeforeInput, after: document.textAfterInput)
        if report == .changed {
            forgetWord()
            suggestionsChanged()
        }
        refreshShift()
        return report
    }

    mutating func refreshShift() {
        guard shift != .locked, shiftHold == nil else { return }
        let mode = settings.autoCapitalization ? traits.autocapitalization : .none
        let capitalize = layer == .letters && Self.shouldCapitalize(text.before, mode: mode)
        shift = capitalize ? .on : .off
    }

    /// The one way text changes: deletes `count` characters before the caret, then inserts `string`, in the host and
    /// in `text` alike.
    mutating func write(_ string: String, replacing count: Int = 0, in document: some TextDocument) {
        if count > 0 {
            document.deleteBackward(count)
            text.deleteBackward(count)
        }
        if !string.isEmpty {
            document.insert(string)
            text.insert(string)
        }
    }

    /// Reads the host once, the first time the engine meets it.
    mutating func attach(_ document: some TextDocument) {
        guard !text.isKnown else { return }
        text.reconcile(before: document.textBeforeInput, after: document.textAfterInput)
    }

    mutating func forgetWord() {
        swipeCommit = nil
        spaceJustTyped = false
        typing = WordTaps()
        stray = nil
        revert = nil
    }
}

extension TypingEngine {
    static let returnsToLetters: Set<String> = ["'"]
    static let wordEnders: Set<String> = [".", ",", "!", "?", ";", ":"]
    static let sentenceEnders: Set<Character> = [".", "!", "?"]
    static let closers: Set<Character> = [")", "]", "\"", "'", "”", "’"]

    static func initialLayer(for kind: InputKind) -> KeyboardLayer {
        switch kind {
        case .number, .decimal: .numbers
        default: .letters
        }
    }

    static func shouldCapitalize(_ text: String?, mode: Autocapitalization) -> Bool {
        let text = text ?? ""
        switch mode {
        case .none:
            return false
        case .allCharacters:
            return true
        case .words:
            return text.last.map { $0.isWhitespace } ?? true
        case .sentences:
            guard let last = text.last(where: { $0 != " " && $0 != "\t" }) else { return true }
            return last.isNewline || (text.last == " " && sentenceEnders.contains(last))
        }
    }

    static func smartQuote(_ text: String, after before: String?) -> String {
        let opens = before?.last.map { $0.isWhitespace || Words.openers.contains($0) } ?? true
        switch text {
        case "'": return opens ? "‘" : "’"
        case "\"": return opens ? "“" : "”"
        default: return text
        }
    }

    static func endsSentenceable(_ text: String?) -> Bool {
        guard let text, text.last == " " else { return false }
        let beforeSpace = text.dropLast()
        guard let previous = beforeSpace.last else { return false }
        return previous.isLetter || previous.isNumber || closers.contains(previous)
    }

    static func wordLength(before text: String?) -> Int {
        guard let text, !text.isEmpty else { return 1 }
        let reversed = text.reversed()
        let whitespace = reversed.prefix { $0.isWhitespace }.count
        let rest = reversed.dropFirst(whitespace)
        guard let first = rest.first else { return max(whitespace, 1) }
        let isWord = first.isLetter || first.isNumber
        let word = isWord ? rest.prefix { $0.isLetter || $0.isNumber || $0 == "'" || $0 == "’" }.count : 1
        return whitespace + word
    }
}
