import CoreText
import UIKit

enum KeyboardFont {
    static func letter(_ size: CGFloat) -> UIFont {
        guard let compact else { return .systemFont(ofSize: size) }
        return CTFontCreateWithFontDescriptor(compact, size, nil) as UIFont
    }

    // The system keyboard draws keycaps in SF Compact, a system font UIKit doesn't expose by name.
    private static let compact: CTFontDescriptor? = {
        let root = ProcessInfo.processInfo.environment["IPHONE_SIMULATOR_ROOT"] ?? ""
        let url = URL(fileURLWithPath: root + "/System/Library/Fonts/Core/SFCompact.ttf") as CFURL
        let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url) as? [CTFontDescriptor]
        return descriptors?.first { CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String == ".SFCompact-Regular" }
    }()
}
