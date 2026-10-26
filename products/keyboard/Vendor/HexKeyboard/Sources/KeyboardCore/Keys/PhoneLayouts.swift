enum PhoneLayouts {
    static func layout(for context: LayoutContext) -> KeyboardLayout {
        switch context.layer {
        case .letters: letters(context)
        case .numbers: numbers(context)
        case .symbols: symbols(context)
        }
    }

    private static func letters(_ context: LayoutContext) -> KeyboardLayout {
        KeyboardLayout(rows: [
            RowItem.keys("qwertyuiop"),
            [.flexible] + RowItem.keys("asdfghjkl") + [.flexible],
            [.key(Key(.shift, width: .pitch(1.3))), .flexible] + RowItem.keys("zxcvbnm") + [.flexible, .key(Key(.delete, width: .pitch(1.3)))],
            bottomRow(context, layerKey: .numbers),
        ])
    }

    private static func numbers(_ context: LayoutContext) -> KeyboardLayout {
        KeyboardLayout(rows: [
            RowItem.keys("1234567890"),
            RowItem.keys("-/:;()$&@\""),
            [.key(Key(.layer(.symbols), width: .pitch(1.3))), .flexible] + punctuation + [.flexible, .key(Key(.delete, width: .pitch(1.3)))],
            bottomRow(context, layerKey: .letters),
        ])
    }

    private static func symbols(_ context: LayoutContext) -> KeyboardLayout {
        KeyboardLayout(rows: [
            RowItem.keys("[]{}#%^*+="),
            RowItem.keys("_\\|~<>€£¥•"),
            [.key(Key(.layer(.numbers), width: .pitch(1.3))), .flexible] + punctuation + [.flexible, .key(Key(.delete, width: .pitch(1.3)))],
            bottomRow(context, layerKey: .letters),
        ])
    }

    private static var punctuation: [RowItem] {
        [".", ",", "?", "!", "'"].map { .key(Key(.character($0), width: .pitch(1.4), alternates: Alternates.for($0))) }
    }

    private static func bottomRow(_ context: LayoutContext, layerKey: KeyboardLayer) -> [RowItem] {
        let side = context.isLandscape ? 2.0 : 2.5
        let leading: [RowItem] = context.showsGlobe
            ? [.key(Key(.layer(layerKey), width: .pitch(side / 2))), .key(Key(.nextKeyboard, width: .pitch(side / 2)))]
            : [.key(Key(.layer(layerKey), width: .pitch(side)))]
        let space = RowItem.key(Key(.space, width: .fill))
        let returnKey = RowItem.key(Key(.return, width: .pitch(side)))
        let character = { (value: String, width: KeyWidth) in RowItem.key(Key(.character(value), width: width)) }
        switch context.kind {
        case .email:
            return leading + [space, character("@", .pitch(1.25)), character(".", .pitch(1.25)), returnKey]
        case .url:
            return leading + [character(".", .fill), character("/", .fill), character(".com", .fill), returnKey]
        case .twitter:
            return leading + [space, character("@", .pitch(1.25)), character("#", .pitch(1.25)), returnKey]
        case .webSearch:
            return leading + [space, character(".", .input), .key(Key(.return, width: .pitch(1.75)))]
        default:
            return leading + [space, returnKey]
        }
    }
}
