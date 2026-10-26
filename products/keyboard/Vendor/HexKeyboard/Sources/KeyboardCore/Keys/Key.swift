public enum KeyboardLayer: Hashable, Sendable, CaseIterable {
    case letters, numbers, symbols
}

public enum KeyAction: Hashable, Sendable {
    case character(String)
    case space
    case delete
    case shift
    case capsLock
    case `return`
    case tab
    case layer(KeyboardLayer)
    case nextKeyboard
    case dismiss
}

public enum KeyWidth: Hashable, Sendable {
    case input
    case pitch(Double)
    case fill

    public var span: Double? {
        switch self {
        case .input: 1
        case .pitch(let value): value
        case .fill: nil
        }
    }
}

public struct Key: Hashable, Sendable {
    public var action: KeyAction
    public var width: KeyWidth
    public var alternates: [String]
    public var secondary: String?
    public var isPair: Bool

    public init(_ action: KeyAction, width: KeyWidth = .input, alternates: [String] = [], secondary: String? = nil, isPair: Bool = false) {
        self.action = action
        self.width = width
        self.alternates = alternates
        self.secondary = secondary
        self.isPair = isPair
    }

    public static func character(_ value: String, alternates: [String] = [], secondary: String? = nil) -> Key {
        Key(.character(value), alternates: alternates, secondary: secondary)
    }

    public func text(shifted: Bool, flicked: Bool = false) -> String? {
        guard case .character(let value) = action else { return nil }
        if flicked, let secondary { return secondary }
        if shifted, isPair, let secondary { return secondary }
        return value
    }

    public var isInput: Bool {
        switch action {
        case .character, .space: true
        default: false
        }
    }
}

public enum RowItem: Hashable, Sendable {
    case key(Key)
    case spacer(KeyWidth)

    public var width: KeyWidth {
        switch self {
        case .key(let key): key.width
        case .spacer(let width): width
        }
    }
}

public struct KeyboardLayout: Hashable, Sendable {
    public var rows: [[RowItem]]
    public var hasNumberRow: Bool

    public init(rows: [[RowItem]], hasNumberRow: Bool = false) {
        self.rows = rows
        self.hasNumberRow = hasNumberRow
    }

    public var keys: [Key] {
        rows.flatMap { $0.compactMap { if case .key(let key) = $0 { key } else { nil } } }
    }
}
