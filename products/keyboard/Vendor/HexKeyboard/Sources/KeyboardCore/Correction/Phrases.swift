/// The words a corpus writes after each word and each pair of words, in one byte array that loads without parsing.
///
/// Layout: `HXP1`, then four little-endian u32s (words, contexts, entries, spelling bytes), then
/// - words: a u32 offset per word into the spellings, then the spellings (lowercase, sorted, each ending in 0);
/// - contexts, sorted: the word before last (u24, `Phrases.none` for a one-word context), the last word (u24), how
///   much the context trusts its own counts (Witten-Bell N / (N + T), u8 in 255ths), and its first entry (u32);
/// - entries: a next word (u24) and P(word | context) as `-ln p` in tenths of a nat (u8), likeliest first.
public final class Phrases: Sendable {
    public let bytes: [UInt8]

    static let header: [UInt8] = Array("HXP1".utf8)
    static let none = 0xFF_FFFF
    static let start = "_start_"
    static let contextSize = 11
    static let entrySize = 4

    let wordCount: Int
    let contextCount: Int
    let entryCount: Int
    let spellings: Int
    let contexts: Int
    let entries: Int

    public init?(bytes: [UInt8]) {
        guard bytes.count >= 20, Array(bytes[0..<4]) == Self.header else { return nil }
        self.bytes = bytes
        wordCount = Self.u32(bytes, 4)
        contextCount = Self.u32(bytes, 8)
        entryCount = Self.u32(bytes, 12)
        spellings = 20 + wordCount * 4
        contexts = spellings + Self.u32(bytes, 16)
        entries = contexts + contextCount * Self.contextSize
        guard bytes.count == entries + entryCount * Self.entrySize else { return nil }
    }

    /// P(word | the words before it) over `below`, P(word) from a model that knows less: the corpus's next words after
    /// the last word, then after the last two, each trusting its counts as much as its Witten-Bell weight says.
    /// `previous` is "" at a sentence's start and nil when unknown; `earlier` is the word before it, read the same way.
    func probability(of word: String, after previous: String?, earlier: String?, below: Double) -> Double {
        let next = id(of: word)
        var p = below
        for context in contexts(after: previous, earlier: earlier) {
            let found = next.flatMap { id in self.entries(of: context).first { $0.word == id } }
            p = context.weight * (found.map { Math.exp($0.logProbability) } ?? 0) + (1 - context.weight) * p
        }
        return p
    }

    /// The words the corpus writes most often after these, from the longest context it has.
    func next(after previous: String?, earlier: String?) -> [String] {
        contexts(after: previous, earlier: earlier).reversed().flatMap { entries(of: $0).map { spelling(of: $0.word) } }
    }

    struct Context {
        let index: Int
        let weight: Double
    }

    struct Entry {
        let word: Int
        let logProbability: Double
    }

    private func contexts(after previous: String?, earlier: String?) -> [Context] {
        guard let previous, let last = id(of: previous.isEmpty ? Self.start : previous) else { return [] }
        let first = previous.isEmpty ? nil : earlier.flatMap { id(of: $0.isEmpty ? Self.start : $0) }
        return [context(Self.none, last), first.flatMap { context($0, last) }].compactMap { $0 }
    }

    private func context(_ first: Int, _ last: Int) -> Context? {
        let key = first << 24 | last
        var low = 0, high = contextCount
        while low < high {
            let middle = (low + high) / 2
            let offset = contexts + middle * Self.contextSize
            let found = Self.u24(bytes, offset) << 24 | Self.u24(bytes, offset + 3)
            if found == key { return Context(index: middle, weight: Double(bytes[offset + 6]) / 255) }
            if found < key { low = middle + 1 } else { high = middle }
        }
        return nil
    }

    private func entries(of context: Context) -> [Entry] {
        let offset = contexts + context.index * Self.contextSize
        let first = Self.u32(bytes, offset + 7)
        let end = context.index + 1 < contextCount ? Self.u32(bytes, offset + Self.contextSize + 7) : entryCount
        return (first..<end).map { index in
            let at = entries + index * Self.entrySize
            return Entry(word: Self.u24(bytes, at), logProbability: -Double(bytes[at + 3]) / 10)
        }
    }

    func id(of word: some StringProtocol) -> Int? {
        let key = Array(word.lowercased().replacing("’", with: "'").utf8)
        var low = 0, high = wordCount
        while low < high {
            let middle = (low + high) / 2
            var at = spellings + Self.u32(bytes, 20 + middle * 4)
            var order = 0
            for byte in key {
                let stored = bytes[at]
                if stored != byte { order = stored == 0 || stored < byte ? -1 : 1; break }
                at += 1
            }
            if order == 0 { order = bytes[at] == 0 ? 0 : 1 }
            if order == 0 { return middle }
            if order < 0 { low = middle + 1 } else { high = middle }
        }
        return nil
    }

    func spelling(of id: Int) -> String {
        let start = spellings + Self.u32(bytes, 20 + id * 4)
        let end = bytes[start...].firstIndex(of: 0)!
        return String(decoding: bytes[start..<end], as: UTF8.self)
    }

    private static func u32(_ bytes: [UInt8], _ at: Int) -> Int {
        Int(bytes[at]) | Int(bytes[at + 1]) << 8 | Int(bytes[at + 2]) << 16 | Int(bytes[at + 3]) << 24
    }

    private static func u24(_ bytes: [UInt8], _ at: Int) -> Int {
        Int(bytes[at]) | Int(bytes[at + 1]) << 8 | Int(bytes[at + 2]) << 16
    }
}

extension Phrases {
    /// What one context saw: the words before (oldest first, `_start_` for a sentence's start), how many words
    /// followed it in all and how many different ones, and the counts of the next words to keep.
    public struct Counts {
        public var words: [String]
        public var total: Double
        public var types: Double
        public var next: [(word: String, count: Double)]

        public init(words: [String], total: Double, types: Double, next: [(word: String, count: Double)]) {
            self.words = words
            self.total = total
            self.types = types
            self.next = next
        }
    }

    public convenience init(contexts: [Counts]) {
        let vocabulary = Set(contexts.flatMap { $0.words + $0.next.map(\.word) }.map { $0.lowercased() }).sorted { Array($0.utf8).lexicographicallyPrecedes(Array($1.utf8)) }
        let ids = Dictionary(uniqueKeysWithValues: vocabulary.enumerated().map { ($1, $0) })
        func key(_ counts: Counts) -> Int {
            let words = counts.words.map { ids[$0.lowercased()]! }
            return (words.count == 2 ? words[0] : Self.none) << 24 | words.last!
        }
        let sorted = contexts.filter { (1...2).contains($0.words.count) && !$0.next.isEmpty }.sorted { key($0) < key($1) }

        var bytes = Self.header
        func append(_ value: Int, _ size: Int) {
            for shift in stride(from: 0, to: size * 8, by: 8) { bytes.append(UInt8(truncatingIfNeeded: value >> shift)) }
        }
        var spellings: [UInt8] = []
        var offsets: [Int] = []
        for word in vocabulary {
            offsets.append(spellings.count)
            spellings += Array(word.utf8) + [0]
        }
        append(vocabulary.count, 4)
        append(sorted.count, 4)
        append(sorted.reduce(0) { $0 + $1.next.count }, 4)
        append(spellings.count, 4)
        offsets.forEach { append($0, 4) }
        bytes += spellings
        var first = 0
        for context in sorted {
            let key = key(context)
            append(key >> 24, 3)
            append(key & 0xFF_FFFF, 3)
            bytes.append(UInt8((context.total / (context.total + context.types) * 255).rounded()))
            append(first, 4)
            first += context.next.count
        }
        for context in sorted {
            for (word, count) in context.next.sorted(by: { $0.count > $1.count }) {
                append(ids[word.lowercased()]!, 3)
                bytes.append(UInt8(min(max((-Math.log(count / context.total) * 10).rounded(), 0), 255)))
            }
        }
        self.init(bytes: bytes)!
    }
}
