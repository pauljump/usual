/// A word list with frequencies, stored as a flat trie in one byte array so it loads without parsing.
///
/// Layout: an 8-byte header (`HXL1`, node count) then 8 bytes per node, children of a node contiguous and in
/// order: letter, word log-probability, subtree log-mass, flags (last sibling, capitalized), first child index.
/// Probabilities are stored as `-ln p` in tenths of a nat (0 means "not a word").
public final class Lexicon: Sendable {
    public let bytes: [UInt8]

    static let header: [UInt8] = Array("HXL1".utf8)
    static let alphabet = 27

    public init?(bytes: [UInt8]) {
        guard bytes.count >= 16, Array(bytes[0..<4]) == Self.header else { return nil }
        self.bytes = bytes
    }

    public var wordCount: Int {
        (0..<(bytes.count - 8) / 8).count { logWord(Node($0)) != nil }
    }

    struct Node: Hashable {
        let index: Int
        init(_ index: Int) { self.index = index }
        var offset: Int { 8 + index * 8 }
    }

    var root: Node { Node(0) }

    func letter(_ node: Node) -> UInt8 { bytes[node.offset] }

    func logWord(_ node: Node) -> Double? {
        let q = bytes[node.offset + 1]
        return q == 0 ? nil : -Double(q) / 10
    }

    func logMass(_ node: Node) -> Double { -Double(bytes[node.offset + 2]) / 10 }

    func isCapitalized(_ node: Node) -> Bool { bytes[node.offset + 3] & 2 != 0 }

    func children(_ node: Node) -> Children {
        let o = node.offset + 4
        let first = Int(bytes[o]) | Int(bytes[o + 1]) << 8 | Int(bytes[o + 2]) << 16 | Int(bytes[o + 3]) << 24
        return Children(lexicon: self, first: first)
    }

    func child(_ node: Node, _ letter: UInt8) -> Node? {
        children(node).first { self.letter($0) == letter }
    }

    func node(for word: some StringProtocol) -> Node? {
        var node = root
        for byte in word.utf8 {
            guard let next = child(node, Self.fold(byte)) else { return nil }
            node = next
        }
        return node
    }

    public func logProbability(of word: some StringProtocol) -> Double? {
        node(for: word).flatMap(logWord)
    }

    /// The word as the lexicon spells it ("I'm" for "im"), if it is one.
    public func canonical(_ word: some StringProtocol) -> String? {
        guard let node = node(for: word), logWord(node) != nil else { return nil }
        let lower = String(word).lowercased()
        return isCapitalized(node) ? lower.prefix(1).uppercased() + lower.dropFirst() : lower
    }

    struct Children: Sequence, IteratorProtocol {
        let lexicon: Lexicon
        var upcoming: Int

        init(lexicon: Lexicon, first: Int) {
            self.lexicon = lexicon
            self.upcoming = first
        }

        mutating func next() -> Node? {
            guard upcoming != 0 else { return nil }
            let node = Node(upcoming)
            upcoming = lexicon.bytes[node.offset + 3] & 1 != 0 ? 0 : upcoming + 1
            return node
        }
    }

    static func fold(_ byte: UInt8) -> UInt8 {
        switch byte {
        case 65...90: byte + 32
        default: byte
        }
    }

    static func index(of letter: UInt8) -> Int? {
        switch letter {
        case 97...122: Int(letter - 97)
        case 39: 26
        default: nil
        }
    }

    static func letter(at index: Int) -> UInt8 { index == 26 ? 39 : UInt8(97 + index) }

    static let labels = (0..<alphabet).map { String(UnicodeScalar(letter(at: $0))) }
}

extension Lexicon {
    /// Builds a lexicon from word counts. Words are folded to lowercase, keeping a leading capital ("I", "English")
    /// when that's how they're spelled; anything outside a–z and the apostrophe is skipped.
    public convenience init(counts: some Sequence<(word: String, count: Double)>) {
        let entries = counts.filter { entry in
            entry.count > 0 && !entry.word.isEmpty && entry.word.utf8.allSatisfy { Lexicon.index(of: Lexicon.fold($0)) != nil }
        }
        let total = entries.reduce(0) { $0 + $1.count }
        let root = Building()
        for (word, count) in entries {
            var node = root
            let p = count / total
            node.mass += p
            for byte in word.utf8 {
                let letter = Self.fold(byte)
                let next = node.children[letter] ?? Building()
                node.children[letter] = next
                node = next
                node.mass += p
            }
            node.probability += p
            if word.first?.isUppercase == true { node.capitalized = true }
        }

        func quantize(_ p: Double) -> UInt8 {
            p <= 0 ? 0 : UInt8(min(max((-Math.log(p) * 10).rounded(), 1), 255))
        }
        var order: [(node: Building, letter: UInt8, last: Bool)] = [(root, 0, true)]
        var firstChild: [Int] = []
        var cursor = 0
        while cursor < order.count {
            let node = order[cursor].node
            let letters = node.children.keys.sorted()
            firstChild.append(letters.isEmpty ? 0 : order.count)
            for (i, letter) in letters.enumerated() { order.append((node.children[letter]!, letter, i == letters.count - 1)) }
            cursor += 1
        }
        var bytes = Self.header
        for shift in stride(from: 0, to: 32, by: 8) { bytes.append(UInt8(truncatingIfNeeded: order.count >> shift)) }
        for (index, entry) in order.enumerated() {
            let flags: UInt8 = (entry.last ? 1 : 0) | (entry.node.capitalized ? 2 : 0)
            bytes += [entry.letter, quantize(entry.node.probability), quantize(min(entry.node.mass, 1)), flags]
            for shift in stride(from: 0, to: 32, by: 8) { bytes.append(UInt8(truncatingIfNeeded: firstChild[index] >> shift)) }
        }
        self.init(bytes: bytes)!
    }
}

extension Lexicon: CandidateSource {
    public func isWord(_ word: String) -> Bool {
        logProbability(of: word) != nil
    }

    public func guesses(for word: TypedWord) -> [String] {
        Corrector(source: self).ranked(word).filter { !$0.isCompletion && !$0.isLiteral }.map(\.word)
    }

    public func completions(for prefix: String) -> [String] {
        mostFrequent(count: 3, startingWith: prefix).filter { $0.utf8.count > prefix.utf8.count }
    }

    public func mostFrequent(count: Int, startingWith prefix: String = "") -> [String] {
        guard let start = node(for: prefix) else { return [] }
        var heap = Heap<(node: Node, spelling: [UInt8], terminal: Bool)>()
        heap.push((start, Array(prefix.lowercased().utf8), false), priority: logMass(start))
        var words: [String] = []
        while words.count < count, let (node, spelling, terminal) = heap.pop() {
            if terminal {
                words.append(canonical(String(decoding: spelling, as: UTF8.self)) ?? "")
                continue
            }
            if let word = logWord(node) { heap.push((node, spelling, true), priority: word) }
            for child in children(node) { heap.push((child, spelling + [letter(child)], false), priority: logMass(child)) }
        }
        return words
    }
}

private final class Building {
    var children: [UInt8: Building] = [:]
    var probability = 0.0
    var mass = 0.0
    var capitalized = false
}
