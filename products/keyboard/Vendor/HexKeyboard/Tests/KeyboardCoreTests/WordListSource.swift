@testable import KeyboardCore

final class WordListSource: CandidateSource {
    let words: [String]

    init(_ words: [String] = ["hello", "help", "helping", "the", "they", "then", "there", "world", "way", "work", "I", "I'm"]) {
        self.words = words
    }

    func isWord(_ word: String) -> Bool {
        words.contains { $0.lowercased() == word.lowercased() }
    }

    func guesses(for word: TypedWord) -> [String] {
        words.filter { distance($0.lowercased(), word.text.lowercased()) == 1 }
    }

    func completions(for prefix: String) -> [String] {
        words.filter { $0.count > prefix.count && $0.lowercased().hasPrefix(prefix.lowercased()) }
    }

    private func distance(_ a: String, _ b: String) -> Int {
        let a = Array(a), b = Array(b)
        var row = Array(0...b.count)
        for i in 1...max(a.count, 1) where !a.isEmpty {
            var previous = row[0]
            row[0] = i
            for j in stride(from: 1, through: b.count, by: 1) {
                let current = row[j]
                row[j] = min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] == b[j - 1] ? 0 : 1))
                previous = current
            }
        }
        return row[b.count]
    }
}

extension TypingEngine {
    static func correcting(_ source: WordListSource = WordListSource()) -> TypingEngine {
        var engine = TypingEngine()
        engine.corrector = Corrector(source: source)
        return engine
    }
}
