import Foundation

/// A sent message from any source. Only used to learn the person's vocabulary.
public struct Message: Codable, Hashable, Sendable {
    public var text: String
    public var date: Date?
    public var source: String

    public init(text: String, date: Date?, source: String) {
        self.text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        self.date = date
        self.source = source
    }
}

public enum Words {
    /// Lowercased word tokens: letters, digits, apostrophes.
    public static func words(_ s: String) -> [String] {
        tokens(s).map { $0.lowercased() }
    }

    /// Word tokens with original casing.
    public static func tokens(_ s: String) -> [String] {
        var out: [String] = []
        var current = ""
        for ch in s {
            if ch.isLetter || ch.isNumber || ch == "'" || ch == "’" {
                current.append(ch == "’" ? "'" : ch)
            } else if !current.isEmpty {
                out.append(current)
                current = ""
            }
        }
        if !current.isEmpty { out.append(current) }
        return out.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "'")) }.filter { !$0.isEmpty }
    }

    public static func isNumber(_ w: String) -> Bool { w.allSatisfy(\.isNumber) }

    /// Messages worth learning from: human prose, not code, logs, or pasted documents.
    public static func isProse(_ s: String) -> Bool {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...600).contains(t.count) else { return false }
        let banned = ["```", "/Users/", "~/", "=>", "->", "$ ", "{\"", "</"]
        if banned.contains(where: { t.contains($0) }) { return false }
        let letters = t.filter(\.isLetter).count
        return Double(letters) / Double(t.count) > 0.6
    }

    static let closing: Set<String> = [".", ",", "?", "!", ";", ":", ")"]

    /// Join decoded words and punctuation with normal spacing and sentence capitals.
    public static func render(_ pieces: [String]) -> String {
        var out = ""
        var capitalize = true
        for p in pieces where !p.isEmpty {
            if closing.contains(p) {
                out += p
                if [".", "?", "!"].contains(p) { capitalize = true }
                continue
            }
            if !out.isEmpty { out += " " }
            var w = p == "i" ? "I" : p.hasPrefix("i'") ? "I" + p.dropFirst() : p
            if capitalize, let first = w.first { w = first.uppercased() + w.dropFirst() }
            out += w
            capitalize = false
        }
        return out
    }
}
