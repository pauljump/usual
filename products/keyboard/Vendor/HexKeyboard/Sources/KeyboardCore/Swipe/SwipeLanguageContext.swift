/// Immutable snapshot for background gesture ranking. Context comes only from text already entered;
/// neither the gesture's intended answer nor later words may enter this model.
public struct SwipeLanguageContext: Sendable {
    let lexicon: Lexicon
    let phrases: Phrases?
    let memory: TypingMemory
    let previous: String?
    let earlier: String?

    public init(lexicon: Lexicon, phrases: Phrases? = nil, memory: TypingMemory,
                precedingText: String) {
        self.lexicon = lexicon
        self.phrases = phrases
        self.memory = memory
        // A swipe also separates a completed tapped word with no explicit space.
        let separated = precedingText.isEmpty || precedingText.last?.isWhitespace == true
            ? precedingText : precedingText + " "
        let context = Words.context(before: Words.current(in: separated), in: separated)
        previous = context.previous
        earlier = context.earlier
    }

    func bonuses(for words: [String], weight: Double) -> [String: Double] {
        guard previous != nil else { return [:] }
        let model = LanguageModel(lexicon: lexicon, memory: memory, phrases: phrases)
        return Dictionary(words.map { word in
            let prior = model.logProbability(word, after: nil)
            let contextual = model.logPrediction(word, after: previous, earlier: earlier)
            // Bounded context evidence can resolve nearby shapes, never make an unrelated path fit.
            return (word, max(-3, min(3, contextual - prior)) * weight)
        }, uniquingKeysWith: { first, _ in first })
    }
}

extension TypingEngine {
    public var swipeLanguageContext: SwipeLanguageContext? {
        guard let corrector, let lexicon = corrector.lexicon else { return nil }
        return SwipeLanguageContext(lexicon: lexicon, phrases: corrector.phrases,
                                    memory: corrector.memory, precedingText: text.before)
    }
}
