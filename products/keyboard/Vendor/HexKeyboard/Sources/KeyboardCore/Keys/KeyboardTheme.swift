public struct RGBA: Hashable, Sendable {
    public var red, green, blue, alpha: Double

    public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    public init(white: Double, alpha: Double = 1) {
        self.init(red: white, green: white, blue: white, alpha: alpha)
    }

    static func rgb(_ red: Double, _ green: Double, _ blue: Double) -> RGBA {
        RGBA(red: red / 255, green: green / 255, blue: blue / 255)
    }

    static let white = RGBA(white: 1)
    static let black = RGBA(white: 0)
}

public enum KeyboardStyle: Hashable, Sendable {
    case ios26, ios27

    public var dimsKeyUnderAccents: Bool { self == .ios27 }
}

public struct KeyboardTheme: Hashable, Sendable {
    public let key: RGBA
    public let keyPressed: RGBA
    public let label: RGBA
    public let secondaryLabel: RGBA
    public let prominent: RGBA
    public let prominentLabel: RGBA
    public let selection: RGBA
    public let selectionLabel: RGBA
    public let shadow: RGBA
    public let candidate: RGBA
    public let candidateHighlighted: RGBA
    public let candidatePill: RGBA
    public let candidateDivider: RGBA
    public let expander: RGBA

    public static func light(_ style: KeyboardStyle) -> KeyboardTheme {
        let ios27 = style == .ios27
        return KeyboardTheme(
            key: .white,
            keyPressed: RGBA(red: 0.67, green: 0.69, blue: 0.73),
            label: .black,
            secondaryLabel: RGBA(white: 0, alpha: 0.32),
            prominent: .rgb(0, 122, 255),
            prominentLabel: .white,
            selection: ios27 ? .rgb(226, 228, 232) : .rgb(0, 122, 255),
            selectionLabel: ios27 ? .black : .white,
            shadow: RGBA(white: 0, alpha: 0.18),
            candidate: ios27 ? .rgb(74, 74, 76) : .rgb(54, 56, 60),
            candidateHighlighted: .rgb(44, 46, 49),
            candidatePill: .rgb(235, 237, 240),
            candidateDivider: .rgb(211, 212, 217),
            expander: .white
        )
    }

    public static func dark(_ style: KeyboardStyle) -> KeyboardTheme {
        let ios27 = style == .ios27
        return KeyboardTheme(
            key: RGBA(white: (ios27 ? 68 : 61) / 255),
            keyPressed: RGBA(white: 0.42),
            label: .white,
            secondaryLabel: RGBA(white: 1, alpha: 0.4),
            prominent: .rgb(10, 132, 255),
            prominentLabel: .white,
            selection: ios27 ? RGBA(white: 0.36) : .rgb(10, 132, 255),
            selectionLabel: .white,
            shadow: RGBA(white: 0, alpha: 0.5),
            candidate: ios27 ? .rgb(162, 162, 162) : .rgb(172, 172, 172),
            candidateHighlighted: .white,
            candidatePill: .rgb(115, 115, 115),
            candidateDivider: ios27 ? .rgb(49, 49, 51) : .rgb(50, 50, 52),
            expander: RGBA(white: 90 / 255)
        )
    }
}
