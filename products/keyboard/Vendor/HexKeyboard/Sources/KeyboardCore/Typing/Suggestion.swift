public struct Suggestion: Hashable, Sendable {
    public enum Kind: Hashable, Sendable {
        case literal, correction, candidate, revert, swipe
    }

    public var text: String
    public var kind: Kind

    public init(_ text: String, _ kind: Kind) {
        self.text = text
        self.kind = kind
    }

    public var title: String {
        kind == .literal ? "“\(text)”" : text
    }
}
