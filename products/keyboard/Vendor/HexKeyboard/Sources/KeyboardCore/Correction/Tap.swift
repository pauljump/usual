public struct Tap: Hashable, Sendable {
    public var x: Double
    public var y: Double
    public var key: String

    public init(x: Double, y: Double, key: String) {
        self.x = x
        self.y = y
        self.key = key
    }
}

public struct TapSample: Hashable, Sendable {
    public var tap: Tap
    public var intended: String

    public init(tap: Tap, intended: String) {
        self.tap = tap
        self.intended = intended
    }
}

public struct TypedWord: Hashable, Sendable {
    public var text: String
    public var taps: [Tap]
    public var previous: String?

    public init(_ text: String, taps: [Tap] = [], previous: String? = nil) {
        self.text = text
        self.taps = taps
        self.previous = previous
    }
}
