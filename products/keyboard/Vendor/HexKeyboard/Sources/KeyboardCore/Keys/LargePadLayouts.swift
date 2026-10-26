enum LargePadLayouts {
    static func layout(for context: LayoutContext) -> KeyboardLayout {
        switch context.layer {
        case .letters:
            KeyboardLayout(rows: [
                numberRow,
                [tab] + RowItem.keys("qwertyuiop[]\\", secondaries: "          {}|", pairs: true),
                [capsLock] + RowItem.keys("asdfghjkl;'", secondaries: "         :\"", pairs: true) + [returnKey],
                [shift] + RowItem.keys("zxcvbnm,./", secondaries: "       <>?", pairs: true) + [trailingShift],
                bottomRow(context, layerKey: .numbers),
            ], hasNumberRow: true)
        case .numbers, .symbols:
            KeyboardLayout(rows: [
                numberRow,
                [tab] + RowItem.keys("[]{}#%^*+=\\|~"),
                [capsLock] + RowItem.keys("-/:;()$&@\"…") + [returnKey],
                [shift] + RowItem.keys("_€£¥•.,?!'") + [trailingShift],
                bottomRow(context, layerKey: .letters),
            ], hasNumberRow: true)
        }
    }

    private static let numberRow: [RowItem] = RowItem.keys("`1234567890-=", secondaries: "~!@#$%^&*()_+", pairs: true) + [.key(Key(.delete, width: .fill))]
    private static let tab = RowItem.key(Key(.tab, width: .pitch(1.54)))
    private static let capsLock = RowItem.key(Key(.capsLock, width: .pitch(1.77)))
    private static let returnKey = RowItem.key(Key(.return, width: .fill))
    private static let shift = RowItem.key(Key(.shift, width: .pitch(2.27)))
    private static let trailingShift = RowItem.key(Key(.shift, width: .fill))

    private static func bottomRow(_ context: LayoutContext, layerKey: KeyboardLayer) -> [RowItem] {
        let leading: [RowItem] = context.showsGlobe ? [.key(Key(.nextKeyboard, width: .pitch(1.415)))] : []
        return leading + [
            .key(Key(.layer(layerKey), width: .pitch(1.415))),
            .key(Key(.space, width: .fill)),
            .key(Key(.layer(layerKey), width: .pitch(2.14))),
            .key(Key(.dismiss, width: .pitch(2.14))),
        ]
    }
}
