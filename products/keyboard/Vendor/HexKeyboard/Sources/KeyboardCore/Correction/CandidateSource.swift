public protocol CandidateSource: AnyObject {
    func isWord(_ word: String) -> Bool
    func guesses(for word: TypedWord) -> [String]
    func completions(for prefix: String) -> [String]
    func predictions(after context: String) -> [String]
}

extension CandidateSource {
    public func predictions(after context: String) -> [String] { [] }
}
