
extension KeyGrid {
    public var swipeKeys: [SwipeKey] {
        rows.flatMap { $0 }.compactMap { item in
            guard let label = item.key.label, label.utf8.count == 1,
                  let byte = label.utf8.first, (97...122).contains(byte) else { return nil }
            return SwipeKey(letter: label, x: item.frame.midX / pitch.x, y: item.frame.midY / pitch.x)
        }
    }
    public func swipeSample(x: Double, y: Double, time: Double) -> SwipeSample {
        SwipeSample(x: x / pitch.x, y: y / pitch.x, time: time)
    }
}

extension Lexicon {
    /// Reuse the installed dictionary and its probabilities; no second dictionary in the extension.
    public var swipeWords: [SwipeWord] {
        var words: [SwipeWord] = []
        func visit(_ node: Node, _ spelling: String) {
            if let p = logWord(node), LocalSwipeDecoder.eligible(spelling) {
                words.append(SwipeWord(word: spelling, frequency: max(1, Int64(Math.exp(p) * 1_000_000_000))))
            }
            guard spelling.count < 20 else { return }
            for child in children(node) { visit(child, spelling + String(UnicodeScalar(letter(child)))) }
        }
        visit(root, "")
        return words
    }
}
