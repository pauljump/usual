public struct KeyFace: Hashable, Sendable {
    public enum Content: Hashable, Sendable {
        case letter(String)
        case text(String)
        case smallText(String)
        case symbol(String)
        case none
    }

    public enum Alignment: Hashable, Sendable {
        case center, bottomLeading, bottomTrailing
    }

    public var content: Content
    public var secondary: String?
    public var corner: String?
    public var secondaryIsDimmed = true
    public var alignment: Alignment = .center
    public var isProminent = false

    public init(content: Content, secondary: String? = nil, secondaryIsDimmed: Bool = true, alignment: Alignment = .center, isProminent: Bool = false) {
        self.content = content
        self.secondary = secondary
        self.secondaryIsDimmed = secondaryIsDimmed
        self.alignment = alignment
        self.isProminent = isProminent
    }
}

public struct KeyFaceContext: Hashable, Sendable {
    public var device: DeviceClass
    public var layer: KeyboardLayer
    public var kind: InputKind
    public var shift: ShiftState
    public var returnKind: ReturnKind
    public var returnEnabled: Bool

    public init(device: DeviceClass, layer: KeyboardLayer, kind: InputKind, shift: ShiftState, returnKind: ReturnKind, returnEnabled: Bool) {
        self.device = device
        self.layer = layer
        self.kind = kind
        self.shift = shift
        self.returnKind = returnKind
        self.returnEnabled = returnEnabled
    }
}

extension KeyFace {
    public init(_ key: Key, trailing: Bool, context: KeyFaceContext) {
        let isPad = context.device != .phone
        let edge: Alignment = isPad ? (trailing ? .bottomTrailing : .bottomLeading) : .center
        switch key.action {
        case .character(let value):
            let shown = context.shift.isUppercase && value.count == 1 ? value.uppercased() : Self.glyphs[value, default: value]
            self.init(content: value.count == 1 ? .letter(shown) : .text(shown))
            secondary = key.secondary
            secondaryIsDimmed = !key.isPair
        case .space:
            self.init(content: .none)
            corner = "usual"
        case .delete:
            self.init(content: .symbol("delete.left"), alignment: edge)
        case .shift:
            let name = switch context.shift {
            case .off: "shift"
            case .on: "shift.fill"
            case .locked: "capslock.fill"
            }
            self.init(content: .symbol(name), alignment: edge)
        case .capsLock:
            self.init(content: .symbol(context.shift == .locked ? "capslock.fill" : "capslock"), alignment: edge)
        case .return:
            let kind = context.returnKind
            self.init(
                content: kind.symbol.map { .symbol($0) } ?? .text(kind.title),
                alignment: edge,
                isProminent: kind.isProminent && context.returnEnabled
            )
        case .tab:
            self.init(content: .symbol("arrow.right.to.line"), alignment: edge)
        case .layer(let layer):
            let title = context.kind == .url && layer == .numbers && context.device == .phone ? ".?123" : Self.title(for: layer, device: context.device)
            let small = context.device == .phone && context.layer != .letters && layer != .letters
            self.init(content: small ? .smallText(title) : .text(title), alignment: edge)
        case .nextKeyboard:
            self.init(content: .symbol("globe"), alignment: edge)
        case .dismiss:
            self.init(content: .symbol("keyboard.chevron.compact.down"), alignment: edge)
        }
    }

    private static let glyphs = ["\"": "”", "'": "’"]

    private static func title(for layer: KeyboardLayer, device: DeviceClass) -> String {
        switch (layer, device) {
        case (.letters, _): "ABC"
        case (.numbers, .phone), (.numbers, .compactPad): "123"
        case (.numbers, _): ".?123"
        case (.symbols, _): "#+="
        }
    }
}
