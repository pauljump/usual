import Foundation

/// The person's own vocabulary: words they use, which word tends to follow which, and how
/// they capitalize names. Learned on the device from messages they send or import.
public struct Lexicon: Codable, Sendable {
    public static let start = "<s>"

    public var version = 1
    /// Word counts from the person's own messages.
    public private(set) var personal: [String: Int] = [:]
    /// General vocabulary, weaker than the person's own.
    public private(set) var background: [String: Int] = [:]
    /// previous word -> next word -> count, from the person's own messages.
    public private(set) var pairs: [String: [String: Int]] = [:]
    /// Preferred casing for words they capitalize mid-sentence (names, products).
    public private(set) var casing: [String: String] = [:]
    /// Last messages they sent, newest last. Context for Jev.
    public private(set) var recent: [String] = []

    public init() {}

    public var wordCount: Int { personal.count }

    public mutating func learn(_ text: String, remember: Bool = false) {
        let toks = Words.tokens(text)
        var prev = Lexicon.start
        for (i, tok) in toks.enumerated() {
            let w = tok.lowercased()
            personal[w, default: 0] += 1
            pairs[prev, default: [:]][w, default: 0] += 1
            if i > 0, tok != w, !Words.isNumber(w) { casing[w] = tok }
            prev = w
        }
        if remember {
            recent.append(text)
            if recent.count > 8 { recent.removeFirst(recent.count - 8) }
        }
    }

    public mutating func learn(_ messages: [Message]) {
        for m in messages where Words.isProse(m.text) { learn(m.text) }
    }

    public mutating func addBackground(_ text: String) {
        for w in Words.words(text) where !Words.isNumber(w) { background[w, default: 0] += 1 }
    }

    /// Drop rare background words so the keyboard extension stays small in memory.
    public mutating func pruneBackground(minCount: Int, keep: Int) {
        let kept = background.filter { $0.value >= minCount }.sorted { $0.value > $1.value }.prefix(keep)
        background = Dictionary(uniqueKeysWithValues: kept.map { ($0.key, $0.value) })
    }

    public mutating func merge(_ other: Lexicon) {
        for (w, c) in other.personal { personal[w, default: 0] += c }
        for (w, c) in other.background { background[w, default: 0] += c }
        for (p, nexts) in other.pairs { for (n, c) in nexts { pairs[p, default: [:]][n, default: 0] += c } }
        casing.merge(other.casing) { _, new in new }
        recent = Array((recent + other.recent).suffix(8))
    }

    public func display(_ w: String) -> String { casing[w] ?? w }

    public static func load(from url: URL) -> Lexicon? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Lexicon.self, from: data)
    }

    public func save(to url: URL) throws {
        try JSONEncoder().encode(self).write(to: url, options: .atomic)
    }
}

/// Fast candidate lookup over a lexicon. Rebuild after learning a batch of messages.
public final class Predictor: @unchecked Sendable {
    public private(set) var lexicon: Lexicon
    private var byLetter: [Character: [String]] = [:]

    /// Words kept per first letter before pair scores reorder them.
    let poolPerLetter = 1500

    public init(_ lexicon: Lexicon) {
        self.lexicon = lexicon
        reindex()
    }

    public func learn(_ text: String) {
        lexicon.learn(text, remember: true)
        reindex()
    }

    private func reindex() {
        var groups: [Character: [String]] = [:]
        for w in Set(lexicon.personal.keys).union(lexicon.background.keys) {
            guard let c = w.first, !Words.isNumber(w) else { continue }
            groups[c, default: []].append(w)
        }
        byLetter = groups.mapValues { ws in
            Array(ws.sorted { base($0) > base($1) }.prefix(poolPerLetter))
        }
    }

    func base(_ w: String) -> Double {
        log1p(Double(lexicon.personal[w] ?? 0)) + 0.3 * log1p(Double(lexicon.background[w] ?? 0))
    }

    public func score(_ w: String, after previous: String) -> Double {
        3 * log1p(Double(lexicon.pairs[previous]?[w] ?? 0)) + base(w)
    }

    /// Words starting with `initial`, best first given the previous word.
    public func candidates(_ prefix: String, after previous: String, limit: Int) -> [(word: String, score: Double)] {
        let p = prefix.lowercased()
        guard let c = p.first else { return [] }
        var pool = (byLetter[c] ?? []).filter { $0.hasPrefix(p) }
        if let followers = lexicon.pairs[previous]?.keys {
            pool += followers.filter { $0.hasPrefix(p) && !pool.contains($0) }
        }
        return pool.map { ($0, score($0, after: previous)) }
            .sorted { $0.1 > $1.1 }
            .prefix(limit)
            .map { (word: $0.0, score: $0.1) }
    }
}
