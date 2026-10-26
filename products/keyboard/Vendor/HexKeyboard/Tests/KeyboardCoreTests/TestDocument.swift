@testable import KeyboardCore

final class TestDocument: TextDocument {
    var text: String
    var cursor: Int

    init(_ text: String = "") {
        self.text = text
        self.cursor = text.count
    }

    var textBeforeInput: String? { String(text.prefix(cursor)) }
    var textAfterInput: String? { String(text.dropFirst(cursor)) }

    func insert(_ value: String) {
        let index = text.index(text.startIndex, offsetBy: cursor)
        text.insert(contentsOf: value, at: index)
        cursor += value.count
    }

    func deleteBackward(_ count: Int) {
        let removed = min(count, cursor)
        let end = text.index(text.startIndex, offsetBy: cursor)
        text.removeSubrange(text.index(end, offsetBy: -removed)..<end)
        cursor -= removed
    }

    func moveCursor(by offset: Int) {
        cursor = min(max(cursor + offset, 0), text.count)
    }
}

extension TypingEngine {
    mutating func type(_ string: String, in document: some TextDocument) {
        for character in string {
            perform(character == " " ? .space : .character(String(character).lowercased()), in: document)
        }
    }
}
