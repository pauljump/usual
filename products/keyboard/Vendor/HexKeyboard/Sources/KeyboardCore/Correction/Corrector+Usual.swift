/// Usual: a bottom-row key can stand where the thumb intended a space.
/// Only unknown compounds are split; valid words, user-kept slang and names stay whole.
extension Corrector {
    func shortSlip(_ typed: TypedWord) -> String? {
        let word = typed.text.lowercased()
        guard let lexicon, memory.total > 0, (1...2).contains(word.count),
              word != "a", word != "i", memory.count(of: word) < 2,
              (lexicon.logProbability(of: word) ?? -100) < -12 else { return nil }
        let candidates = memory.counts.keys.filter { candidate in
            guard candidate.count == 2, memory.count(of: candidate) >= 8 else { return false }
            return word.count == 1 ? candidate.contains(word) : String(candidate.reversed()) == word
        }
        let model = languageModel(lexicon)
        guard let best = candidates.max(by: { model.logProbability($0, after: typed.previous) < model.logProbability($1, after: typed.previous) }) else { return nil }
        return Words.matchCase(best, to: Substring(typed.text))
    }

    func splitJoined(_ typed: TypedWord) -> String? {
        let lower = typed.text.lowercased().replacingCurlyApostrophes()
        guard memory.total > 0, (5...35).contains(lower.count),
              let lexicon, !source.isWord(lower), memory.count(of: lower) < 2,
              lower.allSatisfy({ $0.isLetter || $0 == "'" }) else { return nil }
        let letters = Array(lower)
        let model = languageModel(lexicon)
        func known(_ word: String) -> Bool {
            (word.count >= 2 || word == "a" || word == "i") &&
            (memory.count(of: word) >= 2 || (lexicon.logProbability(of: word) ?? -100) > -12)
        }
        // Only consume an actual bottom-row letter at a boundary. No invented words,
        // arbitrary segmentation, or recursive spell correction inside the fragments.
        // Prefer a complete two-word parse; try three only when two cannot explain it.
        func splits(from start: Int, remaining: Int, previous: String?) -> [(text: String, score: Double)] {
            let tail = String(letters[start...])
            if remaining == 1 {
                return known(tail) ? [(tail, model.logProbability(tail, after: previous))] : []
            }
            guard letters.count - start >= remaining * 2 - 1 else { return [] }
            var found: [(text: String, score: Double)] = []
            for i in (start + 1)..<(letters.count - 1) where "cvbnm".contains(letters[i]) {
                let left = String(letters[start..<i])
                guard known(left) else { continue }
                for rest in splits(from: i + 1, remaining: remaining - 1, previous: left) {
                    let right = String(rest.text.prefix(while: { $0 != " " }))
                    let pair = memory.following[left]?[right] ?? 0
                    found.append((left + " " + rest.text,
                                  model.logProbability(left, after: previous) + rest.score + 2 * Math.log(Double(pair + 1))))
                }
            }
            return found
        }
        for length in 2...3 {
            let ranked = splits(from: 0, remaining: length, previous: typed.previous).sorted { $0.score > $1.score }
            if let first = ranked.first {
                // Ambiguous multi-boundary repairs are suggestions for Finish, not automatic edits.
                if length == 3, ranked.count > 1, first.score - ranked[1].score < 1 { return nil }
                var result = Words.matchCase(first.text, to: Substring(typed.text))
                if typed.text.contains("’") { result = String(result.map { $0 == "'" ? "’" : $0 }) }
                return result
            }
        }
        return nil
    }
}

private extension String {
    func replacingCurlyApostrophes() -> String { String(map { $0 == "’" ? "'" : $0 }) }
}
