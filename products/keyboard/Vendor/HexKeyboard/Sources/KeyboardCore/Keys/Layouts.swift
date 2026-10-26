public enum DeviceClass: Hashable, Sendable, CaseIterable {
    case phone
    case compactPad
    case pad
    case largePad
}

public struct LayoutContext: Hashable, Sendable {
    public var device: DeviceClass
    public var layer: KeyboardLayer
    public var kind: InputKind
    public var showsGlobe: Bool
    public var isLandscape: Bool
    public var oneHanded: OneHanded

    public init(device: DeviceClass, layer: KeyboardLayer, kind: InputKind = .text, showsGlobe: Bool = false, isLandscape: Bool = false, oneHanded: OneHanded = .off) {
        self.device = device
        self.layer = layer
        self.kind = kind
        self.showsGlobe = showsGlobe
        self.isLandscape = isLandscape
        self.oneHanded = oneHanded
        if !allowsOneHanded { self.oneHanded = .off }
    }

    /// Like Apple's, only an upright iPhone narrows its keys for one hand.
    public var allowsOneHanded: Bool { device == .phone && !isLandscape }

    /// The key whose hold offers the one-handed layouts, as Apple's globe does: the layer key in the bottom row, Hex's
    /// own key nearest where the system draws its globe.
    public func oneHandedKey(in layout: KeyboardLayout) -> Key? {
        guard allowsOneHanded else { return nil }
        return layout.rows.last?.lazy.compactMap { item -> Key? in
            if case .key(let key) = item, case .layer = key.action { key } else { nil }
        }.first
    }
}

extension LayoutContext {
    /// What a touch model is kept per: the same keys under the same hands.
    public var signature: String {
        "\(device)-\(isLandscape ? "landscape" : "portrait")-\(layer)" + (oneHanded == .off ? "" : "-\(oneHanded)")
    }

    /// The layout a touch model's signature was kept for.
    public init?(signature: String) {
        let contexts = DeviceClass.allCases.flatMap { device in
            KeyboardLayer.allCases.flatMap { layer in
                [false, true].flatMap { landscape in
                    OneHanded.allCases.map { LayoutContext(device: device, layer: layer, isLandscape: landscape, oneHanded: $0) }
                }
            }
        }
        guard let context = contexts.first(where: { $0.signature == signature }) else { return nil }
        self = context
    }
}

public enum Layouts {
    public static func layout(for context: LayoutContext) -> KeyboardLayout {
        switch context.device {
        case .phone: PhoneLayouts.layout(for: context)
        case .compactPad: CompactPadLayouts.layout(for: context)
        case .pad: PadLayouts.layout(for: context)
        case .largePad: LargePadLayouts.layout(for: context)
        }
    }
}

extension RowItem {
    static func keys(_ primary: String, secondaries: String = "", pairs: Bool = false) -> [RowItem] {
        let secondaries = secondaries.map { $0 == " " ? nil : String($0) }
        return primary.enumerated().map { index, character in
            let value = String(character)
            return .key(Key(
                .character(value),
                alternates: Alternates.for(value),
                secondary: index < secondaries.count ? secondaries[index] : nil,
                isPair: pairs
            ))
        }
    }

    static let flexible = RowItem.spacer(.fill)
}
