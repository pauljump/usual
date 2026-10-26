public enum ShiftState: Hashable, Sendable {
    case off, on, locked

    public var isUppercase: Bool { self != .off }
}
