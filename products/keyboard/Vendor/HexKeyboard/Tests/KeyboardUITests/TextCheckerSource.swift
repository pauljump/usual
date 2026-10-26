import UIKit
import KeyboardCore

@MainActor
final class TextCheckerSource {
    private let checker = UITextChecker()
    private let language: String

    init(language: String) {
        let available = UITextChecker.availableLanguages
        let language = language.replacingOccurrences(of: "-", with: "_")
        self.language = available.contains(language) ? language
            : available.first { $0.hasPrefix(language.prefix(2)) } ?? "en_US"
    }

    private func range(_ word: String) -> NSRange {
        NSRange(location: 0, length: (word as NSString).length)
    }
}

extension TextCheckerSource: @MainActor CandidateSource {
    func isWord(_ word: String) -> Bool {
        checker.rangeOfMisspelledWord(in: word, range: range(word), startingAt: 0, wrap: false, language: language).location == NSNotFound
    }

    func guesses(for word: TypedWord) -> [String] {
        checker.guesses(forWordRange: range(word.text), in: word.text, language: language) ?? []
    }

    func completions(for prefix: String) -> [String] {
        checker.completions(forPartialWordRange: range(prefix), in: prefix, language: language) ?? []
    }
}
