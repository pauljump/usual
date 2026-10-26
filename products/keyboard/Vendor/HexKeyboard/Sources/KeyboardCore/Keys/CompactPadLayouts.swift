enum CompactPadLayouts {
    static func layout(for context: LayoutContext) -> KeyboardLayout {
        switch context.layer {
        case .letters:
            KeyboardLayout(rows: [
                RowItem.keys("qwertyuiop", secondaries: "1234567890") + [delete],
                [.spacer(.pitch(0.4))] + RowItem.keys("asdfghjkl", secondaries: "@#$&*()'\"") + [returnKey],
                [.key(Key(.shift))] + RowItem.keys("zxcvbnm", secondaries: "%-+=/;:") + RowItem.keys(",.", secondaries: "!?", pairs: true) + [.key(Key(.shift, width: .fill))],
                bottomRow(context, layerKey: .numbers),
            ])
        case .numbers:
            KeyboardLayout(rows: [
                RowItem.keys("1234567890") + [delete],
                [.spacer(.pitch(0.4))] + RowItem.keys("-/:;()$&@") + [returnKey],
                [.key(Key(.layer(.symbols)))] + RowItem.keys("…,?!'\"") + [.spacer(.fill), .key(Key(.layer(.symbols), width: .pitch(1.5)))],
                bottomRow(context, layerKey: .letters),
            ])
        case .symbols:
            KeyboardLayout(rows: [
                RowItem.keys("[]{}#%^*+=") + [delete],
                [.spacer(.pitch(0.4))] + RowItem.keys("_\\|~<>€£¥") + [returnKey],
                [.key(Key(.layer(.numbers)))] + RowItem.keys("•.,?!'\"") + [.spacer(.fill), .key(Key(.layer(.numbers), width: .pitch(1.5)))],
                bottomRow(context, layerKey: .letters),
            ])
        }
    }

    private static let delete = RowItem.key(Key(.delete, width: .fill))
    private static let returnKey = RowItem.key(Key(.return, width: .fill))

    private static func bottomRow(_ context: LayoutContext, layerKey: KeyboardLayer) -> [RowItem] {
        let leading: [RowItem] = context.showsGlobe ? [.key(Key(.nextKeyboard, width: .pitch(1.04)))] : []
        return leading + [
            .key(Key(.layer(layerKey), width: .pitch(1.04))),
            .key(Key(.space, width: .fill)),
            .key(Key(.layer(layerKey), width: .pitch(1.56))),
            .key(Key(.dismiss, width: .pitch(1.56))),
        ]
    }
}
