enum Words {
    static let apostrophes: Set<Character> = ["'", "’"]
    static let openers: Set<Character> = ["(", "[", "{", "\"", "“", "'", "‘"]

    static func isWordCharacter(_ character: Character) -> Bool {
        character.isLetter || character.isNumber || apostrophes.contains(character)
    }

    static func current(in text: String) -> Substring {
        let start = text.lastIndex { !isWordCharacter($0) }.map(text.index(after:)) ?? text.startIndex
        return text[start...].drop { apostrophes.contains($0) }
    }

    static func isCorrectable(_ word: Substring, in text: String) -> Bool {
        guard !word.isEmpty, !word.contains(where: \.isNumber) else { return false }
        guard word.startIndex > text.startIndex else { return true }
        let before = text[text.index(before: word.startIndex)]
        return before.isWhitespace || openers.contains(before) || apostrophes.contains(before)
    }

    static func previous(before word: Substring, in text: String) -> String? {
        let head = text[..<word.startIndex]
        guard let last = head.last, last == " " else { return head.isEmpty ? "" : nil }
        let trimmed = head.dropLast { $0 == " " }
        guard let character = trimmed.last else { return "" }
        if TypingEngine.sentenceEnders.contains(character) || character.isNewline { return "" }
        let previous = current(in: String(trimmed))
        return previous.isEmpty ? nil : previous.lowercased()
    }

    /// The two words before a word, each read like `previous`.
    static func context(before word: Substring, in text: String) -> (previous: String?, earlier: String?) {
        let previous = previous(before: word, in: text)
        guard let previous, !previous.isEmpty else { return (previous, nil) }
        let head = String(text[..<word.startIndex].dropLast { $0 == " " })
        return (previous, Self.previous(before: current(in: head), in: head))
    }

    static func matchCase(_ candidate: String, to typed: Substring) -> String {
        guard let first = typed.first, first.isUppercase else { return candidate }
        if typed.count > 1, typed.allSatisfy({ !$0.isLetter || $0.isUppercase }) { return candidate.uppercased() }
        return candidate.prefix(1).uppercased() + candidate.dropFirst()
    }
}

extension Substring {
    func dropLast(while predicate: (Character) -> Bool) -> Substring {
        var result = self
        while let last = result.last, predicate(last) { result.removeLast() }
        return result
    }
}
