enum PadLayouts {
    static func layout(for context: LayoutContext) -> KeyboardLayout {
        switch context.layer {
        case .letters:
            KeyboardLayout(rows: [
                [tab] + RowItem.keys("qwertyuiop", secondaries: "1234567890") + [delete],
                [capsLock] + RowItem.keys("asdfghjkl", secondaries: "@#$&*()'\"") + [returnKey],
                [.key(Key(.shift, width: .pitch(2)))] + RowItem.keys("zxcvbnm", secondaries: "%-+=/;:") + RowItem.keys(",.", secondaries: "!?", pairs: true) + [.key(Key(.shift, width: .fill))],
                bottomRow(context, layerKey: .numbers),
            ])
        case .numbers:
            KeyboardLayout(rows: [
                [tab] + RowItem.keys("1234567890") + [delete],
                [capsLock] + RowItem.keys("@#$&*()'\"", secondaries: "€£¥_^[]{}") + [returnKey],
                [.key(Key(.layer(.symbols), width: .pitch(2)))] + RowItem.keys("%-+=/;:,.", secondaries: "§|~…\\<>!?") + [.key(Key(.layer(.symbols), width: .fill))],
                bottomRow(context, layerKey: .letters),
            ])
        case .symbols:
            KeyboardLayout(rows: [
                [tab] + RowItem.keys("€£¥_^[]{}") + [.spacer(.input), delete],
                [capsLock] + RowItem.keys("§|~…\\<>!?") + [returnKey],
                [.key(Key(.layer(.numbers), width: .pitch(2)))] + RowItem.keys("•`´‘’“”,.") + [.key(Key(.layer(.numbers), width: .fill))],
                bottomRow(context, layerKey: .letters),
            ])
        }
    }

    private static let tab = RowItem.key(Key(.tab, width: .pitch(1.25)))
    private static let delete = RowItem.key(Key(.delete, width: .fill))
    private static let capsLock = RowItem.key(Key(.capsLock, width: .pitch(1.55)))
    private static let returnKey = RowItem.key(Key(.return, width: .fill))

    private static func bottomRow(_ context: LayoutContext, layerKey: KeyboardLayer) -> [RowItem] {
        let leading: [RowItem] = context.showsGlobe ? [.key(Key(.nextKeyboard, width: .pitch(1.05)))] : []
        return leading + [
            .key(Key(.layer(layerKey), width: .pitch(1.05))),
            .key(Key(.space, width: .fill)),
            .key(Key(.layer(layerKey), width: .pitch(1.5))),
            .key(Key(.dismiss, width: .pitch(1.5))),
        ]
    }
}
