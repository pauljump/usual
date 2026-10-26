public enum Autocapitalization: Sendable {
    case none, words, sentences, allCharacters
}

public enum InputKind: Sendable {
    case text, email, url, number, decimal, twitter, webSearch
}

public enum ReturnKind: Hashable, Sendable {
    case `default`, go, google, join, next, route, search, send, yahoo, done, emergencyCall, `continue`

    public var symbol: String? {
        switch self {
        case .default: "return.left"
        case .go: "arrow.right"
        case .google, .yahoo, .search: "magnifyingglass"
        case .send: "arrow.up"
        case .done: "checkmark"
        case .next: "chevron.right"
        case .join, .route, .emergencyCall, .continue: nil
        }
    }

    public var title: String {
        switch self {
        case .join: "join"
        case .route: "route"
        case .emergencyCall: "Emergency Call"
        case .continue: "continue"
        default: "return"
        }
    }

    public var isProminent: Bool {
        switch self {
        case .default, .next, .continue: false
        default: true
        }
    }
}

public struct InputTraits: Hashable, Sendable {
    public var kind: InputKind
    public var returnKind: ReturnKind
    public var autocapitalization: Autocapitalization
    public var smartPunctuation: Bool
    public var returnRequiresText: Bool
    public var autocorrection: Bool
    public var spellChecking: Bool

    public init(
        kind: InputKind = .text,
        returnKind: ReturnKind = .default,
        autocapitalization: Autocapitalization = .sentences,
        smartPunctuation: Bool = true,
        returnRequiresText: Bool = false,
        autocorrection: Bool = true,
        spellChecking: Bool = true
    ) {
        self.kind = kind
        self.returnKind = returnKind
        self.autocapitalization = autocapitalization
        self.smartPunctuation = smartPunctuation
        self.returnRequiresText = returnRequiresText
        self.autocorrection = autocorrection
        self.spellChecking = spellChecking
    }

    public var allowsCorrection: Bool {
        switch kind {
        case .email, .url, .number, .decimal: false
        default: autocorrection
        }
    }
}
