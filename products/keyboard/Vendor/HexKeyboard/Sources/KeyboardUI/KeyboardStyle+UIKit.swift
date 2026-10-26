import UIKit
import KeyboardCore

extension KeyboardStyle {
    static var current: KeyboardStyle {
        if #available(iOS 27, *) { .ios27 } else { .ios26 }
    }
}

extension KeyboardTheme {
    static let lightCurrent = KeyboardTheme.light(.current)
    static let darkCurrent = KeyboardTheme.dark(.current)

    static func current(for traits: UITraitCollection, appearance: UIKeyboardAppearance?) -> KeyboardTheme {
        appearance == .dark || traits.userInterfaceStyle == .dark ? darkCurrent : lightCurrent
    }
}

extension RGBA {
    var ui: UIColor { UIColor(red: red, green: green, blue: blue, alpha: alpha) }
}
