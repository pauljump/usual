public enum KeyboardEvent: Hashable, Sendable {
    case down(Key, tapCount: Int)
    case up(Key)
    case type(Key, Tap)
    case slide(String)
    case trigger(Key)
    case cursor(offset: Int)
    case oneHanded(OneHanded)
    /// A hand picked by holding the layer key, which switched layers as it went down: the letters come back.
    case pickHand(OneHanded)
}
